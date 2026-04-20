import os
os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

from unittest.mock import AsyncMock
import pytest

from lib.rag import retrieve, ChunkRow


def _chunk_record(id=1, content="text", page_start=1, page_end=1, score=0.9):
    return {"id": id, "content": content, "page_start": page_start, "page_end": page_end, "score": score}


@pytest.mark.asyncio
async def test_paper_scope_dedupes_by_page():
    conn = AsyncMock()

    # Top-20 similarity returns duplicates on same page
    similarity_rows = [
        _chunk_record(id=1, page_start=1, score=0.95),
        _chunk_record(id=2, page_start=1, score=0.90),  # same page, lower score
        _chunk_record(id=3, page_start=2, score=0.85),
        _chunk_record(id=4, page_start=3, score=0.80),
    ]
    anchor_rows = [{"content": "Opening paragraph"}]

    call_count = 0
    async def fetch_side_effect(query, *args):
        nonlocal call_count
        call_count += 1
        if "ORDER BY score DESC LIMIT 20" in query:
            return similarity_rows
        if "ORDER BY chunk_index ASC LIMIT 3" in query:
            return anchor_rows
        if "ORDER BY chunk_index ASC LIMIT 6" in query:
            return []
        return []

    conn.fetch.side_effect = fetch_side_effect

    result = await retrieve(conn, document_id=1, question="What is this about?",
                           scope="paper", focus_page=None, selection_text=None, api_key="sk-test")

    # Should dedupe: 3 unique pages, not 4 rows
    assert len(result.supporting_chunks) == 3
    # Highest score page_start=1 chunk should be kept (id=1, score=0.95)
    page1_chunk = [c for c in result.supporting_chunks if c.page_start == 1][0]
    assert page1_chunk.score == 0.95
    assert result.anchor_text == "Opening paragraph"


@pytest.mark.asyncio
async def test_paper_scope_caps_at_8():
    conn = AsyncMock()

    # 15 unique pages
    similarity_rows = [_chunk_record(id=i, page_start=i, score=0.99 - i * 0.01) for i in range(1, 16)]
    anchor_rows = [{"content": "Intro"}]

    async def fetch_side_effect(query, *args):
        if "ORDER BY score DESC LIMIT 20" in query:
            return similarity_rows
        if "ORDER BY chunk_index ASC LIMIT 3" in query:
            return anchor_rows
        return []

    conn.fetch.side_effect = fetch_side_effect

    result = await retrieve(conn, document_id=1, question="summarize the paper",
                           scope="paper", focus_page=None, selection_text=None, api_key="sk-test")
    assert len(result.supporting_chunks) <= 8


@pytest.mark.asyncio
async def test_selection_scope_includes_page_text():
    conn = AsyncMock()

    page_rows = [{"content": "Page 3 paragraph 1"}, {"content": "Page 3 paragraph 2"}]
    supporting_rows = [_chunk_record(id=1, page_start=5, score=0.8)]

    async def fetch_side_effect(query, *args):
        if "page_start <=" in query:
            return page_rows
        if "ORDER BY score DESC LIMIT 4" in query:
            return supporting_rows
        if "ORDER BY chunk_index ASC LIMIT 6" in query:
            return []
        return []

    conn.fetch.side_effect = fetch_side_effect

    result = await retrieve(conn, document_id=1, question="explain this",
                           scope="selection", focus_page=3, selection_text="highlighted text", api_key="sk-test")

    assert result.page_text is not None
    assert "Page 3 paragraph 1" in result.page_text
    assert result.anchor_text is None  # no anchor for selection scope
    # Sources should include focus page with relevance=1
    focus_source = [s for s in result.sources if s["page"] == 3]
    assert len(focus_source) == 1
    assert focus_source[0]["relevance"] == 1.0


@pytest.mark.asyncio
async def test_fallback_when_vector_empty():
    conn = AsyncMock()

    fallback_rows = [
        {"id": 1, "content": "chunk 1", "page_start": 1, "page_end": 1},
        {"id": 2, "content": "chunk 2", "page_start": 1, "page_end": 2},
    ]

    async def fetch_side_effect(query, *args):
        if "ORDER BY score DESC" in query:
            return []
        if "ORDER BY chunk_index ASC LIMIT 3" in query:
            return []  # anchor
        if "ORDER BY chunk_index ASC LIMIT 6" in query:
            return fallback_rows
        return []

    conn.fetch.side_effect = fetch_side_effect

    result = await retrieve(conn, document_id=1, question="hello",
                           scope="paper", focus_page=None, selection_text=None, api_key="sk-test")
    assert len(result.supporting_chunks) == 2
    assert all(c.score == 0.0 for c in result.supporting_chunks)
