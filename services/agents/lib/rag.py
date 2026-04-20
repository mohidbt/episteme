from dataclasses import dataclass
from lib.openrouter_client import embed_texts

MAX_PAGE_TEXT_CHARS = 12_000
MAX_ANCHOR_CHARS = 4_000


@dataclass
class ChunkRow:
    id: int
    content: str
    page_start: int
    page_end: int
    score: float


@dataclass
class RetrievalResult:
    supporting_chunks: list[ChunkRow]
    page_text: str | None
    anchor_text: str | None
    sources: list[dict]


async def retrieve(conn, *, document_id: int, question: str, scope: str,
                   focus_page: int | None, selection_text: str | None, api_key: str) -> RetrievalResult:
    # Expand short paper-scoped queries for better embedding
    words = question.split()
    embedding_query = (
        f"{question} — find relevant passages in the paper"
        if scope == "paper" and 0 < len(words) < 4
        else question
    )

    vecs = await embed_texts(api_key, [embedding_query])
    query_vec = vecs[0]

    supporting_chunks: list[ChunkRow] = []
    page_text: str | None = None
    anchor_text: str | None = None

    if scope in ("selection", "page"):
        # Page text
        if focus_page is not None:
            page_rows = await conn.fetch(
                "SELECT content FROM document_chunks "
                "WHERE document_id = $1 AND page_start <= $2 AND page_end >= $2 "
                "ORDER BY chunk_index ASC",
                document_id, focus_page,
            )
            joined = "\n\n".join(r["content"] for r in page_rows)
            if joined:
                page_text = (joined[:MAX_PAGE_TEXT_CHARS] + "\n…[truncated]") if len(joined) > MAX_PAGE_TEXT_CHARS else joined

        # Top-4 supporting across whole doc
        rows = await conn.fetch(
            "SELECT id, content, page_start, page_end, "
            "(1 - (embedding <=> $2::vector)) AS score "
            "FROM document_chunks "
            "WHERE document_id = $1 AND embedding IS NOT NULL "
            "ORDER BY score DESC LIMIT 4",
            document_id, query_vec,
        )
        supporting_chunks = [ChunkRow(r["id"], r["content"], r["page_start"], r["page_end"], float(r["score"])) for r in rows]
    else:
        # Paper scope: top-20 → dedupe by page → top-8
        rows = await conn.fetch(
            "SELECT id, content, page_start, page_end, "
            "(1 - (embedding <=> $2::vector)) AS score "
            "FROM document_chunks "
            "WHERE document_id = $1 AND embedding IS NOT NULL "
            "ORDER BY score DESC LIMIT 20",
            document_id, query_vec,
        )
        top_k = [ChunkRow(r["id"], r["content"], r["page_start"], r["page_end"], float(r["score"])) for r in rows]

        best_per_page: dict[int, ChunkRow] = {}
        for row in top_k:
            existing = best_per_page.get(row.page_start)
            if not existing or row.score > existing.score:
                best_per_page[row.page_start] = row
        supporting_chunks = sorted(best_per_page.values(), key=lambda r: r.score, reverse=True)[:8]

        # Anchor text
        anchor_rows = await conn.fetch(
            "SELECT content FROM document_chunks "
            "WHERE document_id = $1 AND page_start = ("
            "  SELECT MIN(page_start) FROM document_chunks WHERE document_id = $1"
            ") ORDER BY chunk_index ASC LIMIT 3",
            document_id,
        )
        joined_anchor = "\n\n".join(r["content"] for r in anchor_rows)
        if joined_anchor:
            anchor_text = (joined_anchor[:MAX_ANCHOR_CHARS] + "\n…[truncated]") if len(joined_anchor) > MAX_ANCHOR_CHARS else joined_anchor

    # Fallback if vector search returned nothing
    if not supporting_chunks:
        fallback_rows = await conn.fetch(
            "SELECT id, content, page_start, page_end FROM document_chunks "
            "WHERE document_id = $1 ORDER BY chunk_index ASC LIMIT 6",
            document_id,
        )
        supporting_chunks = [ChunkRow(r["id"], r["content"], r["page_start"], r["page_end"], 0.0) for r in fallback_rows]

    # Build sources
    sources_map: dict[int, float] = {}
    if focus_page is not None and scope in ("selection", "page"):
        sources_map[focus_page] = 1.0
    for r in supporting_chunks:
        if r.page_start not in sources_map:
            sources_map[r.page_start] = r.score
    sources = [{"page": p, "relevance": rel} for p, rel in sources_map.items()]

    return RetrievalResult(
        supporting_chunks=supporting_chunks,
        page_text=page_text,
        anchor_text=anchor_text,
        sources=sources,
    )
