from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


@pytest.mark.asyncio
async def test_pdf_read_text_calls_papers_pages_route():
    from tools.pdfs import pdf_read_text

    with patch("tools.pdfs.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"pageNumber": 2, "text": "page two text"}
        out = await pdf_read_text.ainvoke({"paper_id": "p1", "page": 2}, config=CFG)

    assert out == {"pageNumber": 2, "text": "page two text"}
    call = mock_get.await_args
    assert call.args[0] == "/api/papers/p1/pages/2/text"
    assert call.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_pdf_read_tables_is_unavailable():
    from tools.pdfs import pdf_read_tables

    out = await pdf_read_tables.ainvoke({"paper_id": "p9", "page": 1}, config=CFG)
    assert out == {"error": True, "status": None, "body": "tool unavailable in this build"}


@pytest.mark.asyncio
async def test_pdf_extract_data_is_unavailable():
    from tools.pdfs import pdf_extract_data

    out = await pdf_extract_data.ainvoke(
        {"paper_id": "p77", "schema": {"type": "object"}}, config=CFG
    )
    assert out == {"error": True, "status": None, "body": "tool unavailable in this build"}
