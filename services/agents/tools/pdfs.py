"""LangChain tools for PDF/paper operations in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.

"""
import json
import uuid
from urllib.parse import quote_plus

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get, km_post
from tools._auth import user_id_from_config
from tools._drive_filter import filter_hidden


# Cap on the zero-hit fallback list. Protects token budget when the user
# has hundreds of papers — model retries on a bad query won't repeatedly
# pump full libraries through context.
_FIND_PAPERS_FALLBACK_CAP = 50


_UNAVAILABLE = {
    "error": True,
    "status": None,
    "body": "tool unavailable in this build",
}


@tool
async def find_papers(
    query: str | None = None,
    libraryId: int | None = None,
    *,
    config: RunnableConfig,
) -> object:
    """Find papers / PDFs in the user's library — single entry point.

    Default behavior (no ``query``): returns every paper across every
    library the user owns. Use this for browse / list / "what do I have"
    intents AND for topic questions like "do I have anything on X?" —
    inspecting the full list is how you discover topical matches.

    With ``query``: filters by title/filename substring. If the filtered
    result is non-empty, the response is ``{"results": [...], "matched":
    true, "query": "..."}``. If filtered to zero matches, falls back
    automatically to the full library list and returns ``{"results":
    [...], "matched": false, "fallback_used": true, "query": "..."}`` —
    so you never reach a dead-end and can still recommend related work.

    Never invent a libraryId. They are opaque integers; omit to span all
    the user's libraries.

    Args:
        query: Optional title/filename substring. Leave None for a full
            list (the right default for vague intents).
        libraryId: Optional numeric library id from ``list_libraries`` to
            scope the search. Omit to span every library the user owns.
    """
    user_id = user_id_from_config(config)

    async def _full_list() -> list:
        if libraryId is not None:
            data = await km_get(f"/api/papers?libraryId={libraryId}", user_id=user_id)
            return filter_hidden(data) if isinstance(data, list) else []
        libs = await km_get("/api/libraries", user_id=user_id)
        if not isinstance(libs, list) or not libs:
            return []
        out: list = []
        for lib in libs:
            rows = await km_get(f"/api/papers?libraryId={lib['id']}", user_id=user_id)
            if isinstance(rows, list):
                out.extend(rows)
        return filter_hidden(out)

    if query is None or not query.strip():
        return {"results": await _full_list(), "matched": False, "query": None}

    raw = await km_get(f"/api/pdfs/search?q={quote_plus(query)}", user_id=user_id)
    hits = filter_hidden(raw) if isinstance(raw, list) else []
    if hits:
        return {"results": hits, "matched": True, "query": query}

    # Zero-hit fallback: return up to `_FIND_PAPERS_FALLBACK_CAP` papers
    # so the model can scan titles for a topical match instead of
    # dead-ending. Cap protects context budget on repeated retries with
    # bad queries when the library has 200+ papers.
    full = await _full_list()
    truncated = len(full) > _FIND_PAPERS_FALLBACK_CAP
    return {
        "results": full[:_FIND_PAPERS_FALLBACK_CAP],
        "matched": False,
        "fallback_used": True,
        "truncated": truncated,
        "total_available": len(full),
        "query": query,
    }


@tool
async def list_pdfs(libraryId: int | None = None, *, config: RunnableConfig) -> object:
    """List individual PDF files / papers in the user's library.

    This is the DEFAULT tool when the user asks to browse / show my papers /
    list my library / "which papers do I have" / "what's in my library" — use
    this UNLESS the user explicitly named a specific paper title or keyword
    to look up (in which case use search_pdfs).

    DO NOT USE THIS for papersets, spreadsheets, CSVs, extraction tables, or
    any tabular/structured data — those are a different concept. Use
    `browse_papersets` for paperset/spreadsheet/CSV/table listings.

    Behavior:
    - If `libraryId` is omitted, returns the UNION of papers across EVERY
      library the user owns. This is the right default for "which papers
      do I have?" — users often have more than one library and the model
      should not silently pick one.
    - If `libraryId` is provided, scopes to that one library.

    NEVER guess or invent a libraryId — they are opaque integers (e.g.
    587, 17018), not sequential.

    Args:
        libraryId: Optional numeric library ID (from list_libraries) to
            restrict the query. Omit to see every paper the user has.
    """
    user_id = user_id_from_config(config)
    if libraryId is not None:
        return filter_hidden(
            await km_get(f"/api/papers?libraryId={libraryId}", user_id=user_id)
        )
    libs = await km_get("/api/libraries", user_id=user_id)
    if not isinstance(libs, list) or not libs:
        return {"error": True, "message": "No libraries found for user"}
    out: list = []
    for lib in libs:
        rows = await km_get(f"/api/papers?libraryId={lib['id']}", user_id=user_id)
        if isinstance(rows, list):
            out.extend(rows)
    return filter_hidden(out)


@tool
async def search_pdfs(query: str, *, config: RunnableConfig) -> object:
    """Search across the user's PDFs/papers by title or filename.

    Use ONLY when the user names a specific paper title or author (e.g.
    "open the BERT paper", "find the attention paper"). Topic questions
    like "do I have a paper on X?" should call `list_pdfs` first — the
    keyword rarely appears verbatim in titles.

    MANDATORY FALLBACK: if this returns an empty list, you MUST call
    `list_pdfs` next before answering. The user's keyword may not match a
    title literally; only the full library list confirms presence/absence.
    Never tell the user "no paper found" based on `search_pdfs` alone.

    Returns up to 20 matches (id, title, filename, year, doi).

    Args:
        query: Substring to match against title/filename. Must be a
            non-empty, specific term — never call this with an empty string
            or a generic placeholder.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/pdfs/search?q={quote_plus(query)}", user_id=user_id)


@tool
async def pdf_read_text(
    paper_id: str,
    page: int,
    *,
    config: RunnableConfig,
) -> object:
    """Read text from a single page of a paper PDF.

    For multi-page or full-document text, use ``read_paper`` with
    ``scope={"kind": "pages", "range": [lo, hi]}`` or ``scope={"kind": "full"}``.

    Args:
        paper_id: Paper UUID.
        page: 1-based page number (required).
    """
    user_id = user_id_from_config(config)
    return await km_get(
        f"/api/papers/{quote_plus(paper_id)}/pages/{page}/text",
        user_id=user_id,
    )


@tool
async def highlight(
    pdf_id: str,
    block_ids: list[str],
    note: str | None = None,
    color: str | None = None,
    *,
    config: RunnableConfig,
) -> object:
    """Create a highlight annotation on a PDF, anchored to one or more blocks.

    Use this tool whenever the user asks to highlight, mark, annotate, or save
    a passage on the page. Do NOT respond with the quoted text alone — always
    call this tool to persist the highlight in the reader.

    Pass `block_ids` returned by `read_paper` — the tool resolves each block
    to its page/bbox via document_segments and persists a single highlight
    spanning all blocks. The reader UI will draw a visible rectangle for each
    block on the matching page.

    Args:
        pdf_id: Paper UUID.
        block_ids: Block IDs from `read_paper` (format: ``{paper_id}:p{page}:{order_index}``).
            All block_ids must reference the same `pdf_id`.
        note: Optional Markdown commentary attached to the highlight.
        color: Optional color string (e.g. "yellow", "amber").
    """
    user_id = user_id_from_config(config)
    if not block_ids:
        return {"error": True, "message": "block_ids must contain at least one entry"}

    # Parse block_ids → list of (page, order_index). Block id shape from
    # tools/papers.py: f"{paper_id}:p{page}:{order_index}".
    order_indexes: list[int] = []
    for bid in block_ids:
        try:
            paper_part, page_part, oi_part = bid.split(":")
        except ValueError:
            return {"error": True, "message": f"malformed block_id: {bid!r}"}
        if paper_part != pdf_id:
            return {
                "error": True,
                "message": f"block_id {bid!r} does not belong to pdf_id {pdf_id!r}",
            }
        if not page_part.startswith("p"):
            return {"error": True, "message": f"malformed block_id: {bid!r}"}
        try:
            order_indexes.append(int(oi_part))
        except ValueError:
            return {"error": True, "message": f"malformed block_id: {bid!r}"}

    from deps import db as db_module
    pool = db_module._pool
    if pool is None:
        return {"error": True, "message": "db pool not initialized"}
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT page, bbox, order_index
              FROM document_segments
             WHERE paper_id = $1
               AND order_index = ANY($2::int[])
             ORDER BY order_index
            """,
            pdf_id,
            order_indexes,
        )
    if not rows:
        return {
            "error": True,
            "message": "no document_segments found for given block_ids — paper may not be parsed yet",
        }

    bbox_list: list[dict] = []
    page_for_payload: int | None = None
    for row in rows:
        # document_segments.page is stored 0-based; KM highlight API expects
        # 1-based positive page numbers.
        page_1 = int(row["page"]) + 1
        bbox_raw = row["bbox"]
        bbox = json.loads(bbox_raw) if isinstance(bbox_raw, str) else bbox_raw
        if not bbox:
            continue
        bbox_list.append({
            "page": page_1,
            "x0": float(bbox["x0"]),
            "y0": float(bbox["y0"]),
            "x1": float(bbox["x1"]),
            "y1": float(bbox["y1"]),
        })
        if page_for_payload is None:
            page_for_payload = page_1
    if not bbox_list or page_for_payload is None:
        return {"error": True, "message": "matched blocks have no bbox data"}

    # B5 — stable run_id per agent run. The KM agent router injects
    # ``configurable.run_id`` for the duration of one /invoke call so multiple
    # highlight() invocations within that single turn share one runId and
    # collapse into a single reader-sidebar entry. Fall back to a fresh UUID
    # only when no run_id was plumbed through (e.g. ad-hoc invocations).
    configurable = config.get("configurable") if isinstance(config, dict) else None
    ctx_run_id = configurable.get("run_id") if isinstance(configurable, dict) else None
    run_id = ctx_run_id if isinstance(ctx_run_id, str) and ctx_run_id else str(uuid.uuid4())
    body: dict = {
        "paperId": pdf_id,
        "page": page_for_payload,
        "bbox": bbox_list,
        "runId": run_id,
    }
    if note is not None:
        body["noteMd"] = note
    if color is not None:
        body["color"] = color
    result = await km_post("/api/paper-highlights", body, user_id=user_id)
    highlight_id = result.get("id") if isinstance(result, dict) else None
    return {
        "ok": True,
        "page": page_for_payload,
        "highlight_ids": [highlight_id] if highlight_id else [],
    }


@tool
async def pdf_read_tables(
    paper_id: str, page: int | None = None, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] Use ``read_paper`` with ``scope={"kind": "blocks", "types": ["table"]}`` instead."""
    _ = (paper_id, page, config)
    return _UNAVAILABLE


@tool
async def pdf_extract_data(
    paper_id: str, schema: dict, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] No backend route on main. Use ``read_paper`` then have the LLM extract structured fields."""
    _ = (paper_id, schema, config)
    return _UNAVAILABLE


@tool
async def pdf_explain_passage(
    paper_id: str,
    page: int,
    text: str,
    *,
    config: RunnableConfig,
) -> object:
    """Explain a selected passage from a paper PDF.

    Fetches the surrounding page text so the agent can ground its
    explanation in the passage's context. The agent's main LLM
    synthesises the final explanation from the structured result.

    Args:
        paper_id: Paper UUID.
        page: 1-based page number where the passage appears.
        text: The selected passage text to explain.
    """
    user_id = user_id_from_config(config)
    page_context = await km_get(
        f"/api/papers/{quote_plus(paper_id)}/pages/{page}/text",
        user_id=user_id,
    )
    return {
        "paper_id": paper_id,
        "page": page,
        "passage": text,
        "page_context": page_context,
    }


@tool
async def extract_passages(
    pdf_id: str, query: str, k: int = 5, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] Placeholder retained for compatibility imports."""
    _ = (pdf_id, query, k, config)
    return _UNAVAILABLE


@tool
async def get_page_text(pdf_id: str, page: int, *, config: RunnableConfig) -> object:
    """[UNAVAILABLE] Placeholder retained for compatibility imports."""
    _ = (pdf_id, page, config)
    return _UNAVAILABLE


# Tools advertised to the LLM. `find_papers` replaces the old list_pdfs +
# search_pdfs pair — single entry-point semantics so the system prompt no
# longer needs a tool-choice rule. The legacy functions remain importable
# for any non-LLM caller but are not exposed to the model.
TOOLS = [
    find_papers,
    pdf_read_text,
    highlight,
    pdf_explain_passage,
]
