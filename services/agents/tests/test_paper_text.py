from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from lib.paper_text import resolve_paper_text


class _Conn:
    def __init__(self, rows=None):
        self._rows = rows or []
        self.fetch = AsyncMock(return_value=self._rows)


@pytest.mark.asyncio
async def test_resolve_paper_text_cache_hit_short_circuits_downstream():
    conn = _Conn(rows=[{"content": "cached-md-1"}, {"content": "cached-md-2"}])
    pdf_reader = AsyncMock()
    fallback = AsyncMock()

    out = await resolve_paper_text(
        paper_id="p1",
        conn=conn,
        page=None,
        pdf_reader=pdf_reader,
        chandra_fallback=fallback,
    )

    assert out["source"] == "cache"
    assert "cached-md-1" in out["text"]
    pdf_reader.assert_not_awaited()
    fallback.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_paper_text_pdfplumber_happy_path_avoids_fallback():
    conn = _Conn(rows=[])
    pdf_reader = AsyncMock(return_value={"pages": [{"pageNumber": 1, "text": "x" * 80}]})
    fallback = AsyncMock()

    out = await resolve_paper_text(
        paper_id="p2",
        conn=conn,
        page=1,
        pdf_reader=pdf_reader,
        chandra_fallback=fallback,
        min_chars_per_page=50,
        sample_pages=1,
    )

    assert out["source"] == "pdfplumber"
    assert out["pages"][0]["pageNumber"] == 1
    fallback.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_paper_text_triggers_fallback_and_progress_callback():
    conn = _Conn(rows=[])
    events: list[tuple[str, str]] = []

    async def progress(stage: str, pid: str) -> None:
        events.append((stage, pid))

    pdf_reader = AsyncMock(return_value={"pages": [{"pageNumber": 1, "text": "tiny"}]})
    fallback = AsyncMock(return_value={"text": "from-chandra"})

    out = await resolve_paper_text(
        paper_id="p3",
        conn=conn,
        page=None,
        pdf_reader=pdf_reader,
        chandra_fallback=fallback,
        progress_cb=progress,
        min_chars_per_page=50,
        sample_pages=1,
    )

    assert out["source"] == "chandra"
    assert out["text"] == "from-chandra"
    fallback.assert_awaited_once()
    assert events == [("fallback_triggered", "p3"), ("fallback_done", "p3")]
