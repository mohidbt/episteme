from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


@pytest.mark.asyncio
async def test_pdf_explain_passage_returns_structured_context():
    from tools.pdfs import pdf_explain_passage

    page_context = {"pageNumber": 3, "text": "page 3 full text"}

    with patch("tools.pdfs.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = page_context
        out = await pdf_explain_passage.ainvoke(
            {"paper_id": "p1", "page": 3, "text": "selected passage"},
            config=CFG,
        )

    assert out == {
        "paper_id": "p1",
        "page": 3,
        "passage": "selected passage",
        "page_context": page_context,
    }
    call = mock_get.await_args
    assert call.args[0] == "/api/papers/p1/pages/3/text"
    assert call.kwargs["user_id"] == USER
