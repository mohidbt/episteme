from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


@pytest.mark.asyncio
async def test_pdf_read_text_uses_dispatch_helper():
    from tools.pdfs import pdf_read_text

    @asynccontextmanager
    async def _fake_conn_ctx():
        yield object()

    with patch("tools.pdfs._conn_ctx", _fake_conn_ctx), patch("tools.pdfs.resolve_paper_text", new_callable=AsyncMock) as mock_resolve:
        mock_resolve.return_value = {"source": "cache", "text": "ok", "pages": []}
        out = await pdf_read_text.ainvoke({"paper_id": "p1", "page": 2}, config=CFG)

    assert out["source"] == "cache"
    assert out["text"] == "ok"
    kwargs = mock_resolve.await_args.kwargs
    assert kwargs["paper_id"] == "p1"
    assert kwargs["page"] == 2


@pytest.mark.asyncio
async def test_pdf_read_tables_calls_km_post_route():
    from tools.pdfs import pdf_read_tables

    with patch("tools.pdfs.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"tables": [{"pageNumber": 1, "rows": [["a"]]}]}
        out = await pdf_read_tables.ainvoke({"paper_id": "p9", "page": 1}, config=CFG)

    assert out["tables"][0]["pageNumber"] == 1
    call = mock_post.await_args
    assert call.args[0] == "/api/pdfs/read-tables"
    assert call.args[1] == {"paperId": "p9", "page": 1}
    assert call.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_pdf_extract_data_calls_km_post_route_with_schema():
    from tools.pdfs import pdf_extract_data

    schema = {
        "type": "object",
        "properties": {"dose": {"type": "number"}},
    }

    with patch("tools.pdfs.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"data": {"dose": 20}}
        out = await pdf_extract_data.ainvoke({"paper_id": "p77", "schema": schema}, config=CFG)

    assert out == {"data": {"dose": 20}}
    call = mock_post.await_args
    assert call.args[0] == "/api/pdfs/extract-data"
    assert call.args[1] == {"paperId": "p77", "schema": schema}
    assert call.kwargs["user_id"] == USER
