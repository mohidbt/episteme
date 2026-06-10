"""GSD-58: list_user_highlights + delete_user_highlight round-trip tools.

KM routes wrapped:
* GET /api/user-highlights?paperId=...
* DELETE /api/user-highlights/{highlightId}
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


def test_list_user_highlights_in_TOOLS():
    from tools import ALL_TOOLS

    names = {t.name for t in ALL_TOOLS}
    assert "list_user_highlights" in names


def test_delete_user_highlight_in_TOOLS():
    from tools import ALL_TOOLS

    names = {t.name for t in ALL_TOOLS}
    assert "delete_user_highlight" in names


def test_delete_user_highlight_requires_approval():
    """Destructive op — HumanInTheLoopMiddleware must gate it."""
    from tools.user_highlights import delete_user_highlight

    md = getattr(delete_user_highlight, "metadata", None) or {}
    assert md.get("require_approval") is True


@pytest.mark.asyncio
async def test_list_user_highlights_calls_km_with_paper_id():
    from tools.user_highlights import list_user_highlights

    expected = {"highlights": [{"id": 1, "paperId": "p1"}]}
    with patch("tools.user_highlights.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = expected
        out = await list_user_highlights.ainvoke({"paper_id": "p1"}, config=CFG)

    assert out == expected
    call = mock_get.await_args
    assert call.args[0] == "/api/user-highlights?paperId=p1"
    assert call.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_list_user_highlights_without_paper_id_returns_validation_error():
    """KM route requires paperId; tool surfaces that requirement cleanly
    rather than hitting the route and getting 400."""
    from tools.user_highlights import list_user_highlights

    out = await list_user_highlights.ainvoke({}, config=CFG)
    assert isinstance(out, dict)
    assert out.get("error") is True
    assert "paper_id" in (out.get("message") or "").lower()


@pytest.mark.asyncio
async def test_delete_user_highlight_calls_km_delete():
    from tools.user_highlights import delete_user_highlight

    with patch("tools.user_highlights.km_delete", new_callable=AsyncMock) as mock_del:
        mock_del.return_value = {"ok": True, "status": 204}
        out = await delete_user_highlight.ainvoke(
            {"highlight_id": "42"}, config=CFG
        )

    assert out == {"ok": True, "status": 204}
    call = mock_del.await_args
    assert call.args[0] == "/api/user-highlights/42"
    assert call.kwargs["user_id"] == USER
