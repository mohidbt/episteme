from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any


ProgressCb = Callable[[str, str], Awaitable[None]]
PdfReaderCb = Callable[[str, int | None], Awaitable[dict[str, Any]]]
ChandraFallbackCb = Callable[[str, int | None], Awaitable[dict[str, Any]]]


async def _cache_markdown(conn, paper_id: str) -> str | None:
    rows = await conn.fetch(
        """
        SELECT content
          FROM document_sections
         WHERE paper_id = $1
           AND mode = 'convert_accurate'
         ORDER BY section_index
        """,
        paper_id,
    )
    if not rows:
        return None
    parts = [(r.get("content") or "").strip() for r in rows]
    text = "\n\n".join(p for p in parts if p)
    return text or None


def _is_pdfplumber_usable(
    pages: list[dict[str, Any]],
    *,
    min_chars_per_page: int,
    sample_pages: int,
) -> bool:
    if not pages:
        return False
    sample = pages[: max(sample_pages, 1)]
    if not sample:
        return False
    return all(len((p.get("text") or "").strip()) >= min_chars_per_page for p in sample)


async def resolve_paper_text(
    *,
    paper_id: str,
    conn,
    page: int | None,
    pdf_reader: PdfReaderCb,
    chandra_fallback: ChandraFallbackCb,
    progress_cb: ProgressCb | None = None,
    min_chars_per_page: int = 50,
    sample_pages: int = 2,
) -> dict[str, Any]:
    cached = await _cache_markdown(conn, paper_id)
    if cached:
        return {"source": "cache", "text": cached, "pages": []}

    pdf_text = await pdf_reader(paper_id, page)
    pages = pdf_text.get("pages") or []
    if _is_pdfplumber_usable(
        pages,
        min_chars_per_page=min_chars_per_page,
        sample_pages=sample_pages,
    ):
        return {
            "source": "pdfplumber",
            "text": "\n\n".join((p.get("text") or "") for p in pages),
            "pages": pages,
        }

    if progress_cb is not None:
        await progress_cb("fallback_triggered", paper_id)
    fallback = await chandra_fallback(paper_id, page)
    if progress_cb is not None:
        await progress_cb("fallback_done", paper_id)
    return {"source": "chandra", "text": fallback.get("text", ""), "pages": []}
