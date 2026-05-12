"""Unit tests for GroundingGuard middleware.

RED: module does not yet exist → all tests fail with ImportError.
GREEN: implement services/agents/middleware/grounding_guard.py.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage, ToolMessage


# ---------------------------------------------------------------------------
# Minimal stub helpers
# ---------------------------------------------------------------------------

def _make_request(
    tool_name: str,
    tool_call_args: dict,
    messages: list,
    tool_call_id: str = "call-1",
) -> SimpleNamespace:
    """Build a minimal ToolCallRequest-like stub."""
    return SimpleNamespace(
        tool=SimpleNamespace(name=tool_name),
        tool_call={"id": tool_call_id, "name": tool_name, "args": tool_call_args},
        state={"messages": messages},
    )


def _make_read_paper_pair(paper_id: str, tool_call_id: str = "rc-1") -> tuple:
    """Build an AIMessage + ToolMessage pair for a read_paper call."""
    ai_msg = AIMessage(
        content="",
        tool_calls=[{"id": tool_call_id, "name": "read_paper", "args": {"paper_id": paper_id, "scope": "abstract"}}],
    )
    tool_msg = ToolMessage(
        content="<paper>...",
        name="read_paper",
        tool_call_id=tool_call_id,
    )
    return ai_msg, tool_msg


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_csv_write_cell_without_prior_read_blocked():
    """csv_write_cell with grounding.paper_id but no prior read_paper → error ToolMessage."""
    from middleware.grounding_guard import GroundingGuard  # noqa: PLC0415

    handler = AsyncMock()
    request = _make_request(
        tool_name="csv_write_cell",
        tool_call_args={"grounding": {"paper_id": "abc"}},
        messages=[],
    )

    result = await GroundingGuard().awrap_tool_call(request, handler)

    assert handler.called is False
    assert isinstance(result, ToolMessage)
    assert result.status == "error"
    assert "must call read_paper" in result.content


@pytest.mark.asyncio
async def test_csv_write_cell_with_prior_read_passes_through():
    """csv_write_cell when prior read_paper for same paper_id exists → handler called."""
    from middleware.grounding_guard import GroundingGuard  # noqa: PLC0415

    ai_msg, tool_msg = _make_read_paper_pair(paper_id="abc")
    handler = AsyncMock(return_value=ToolMessage(content="ok", tool_call_id="call-1"))
    request = _make_request(
        tool_name="csv_write_cell",
        tool_call_args={"grounding": {"paper_id": "abc"}},
        messages=[ai_msg, tool_msg],
    )

    result = await GroundingGuard().awrap_tool_call(request, handler)

    assert handler.called is True
    assert result.content == "ok"


@pytest.mark.asyncio
async def test_different_paper_id_blocked():
    """Prior read for 'other' does NOT satisfy guard for 'abc'."""
    from middleware.grounding_guard import GroundingGuard  # noqa: PLC0415

    ai_msg, tool_msg = _make_read_paper_pair(paper_id="other")
    handler = AsyncMock()
    request = _make_request(
        tool_name="csv_write_cell",
        tool_call_args={"grounding": {"paper_id": "abc"}},
        messages=[ai_msg, tool_msg],
    )

    result = await GroundingGuard().awrap_tool_call(request, handler)

    assert handler.called is False
    assert isinstance(result, ToolMessage)
    assert result.status == "error"


@pytest.mark.asyncio
async def test_unrelated_tool_passes_through():
    """Non-csv_write_cell tool is always passed through without guard logic."""
    from middleware.grounding_guard import GroundingGuard  # noqa: PLC0415

    handler = AsyncMock(return_value=ToolMessage(content="read", tool_call_id="rc-1"))
    request = _make_request(
        tool_name="read_paper",
        tool_call_args={"paper_id": "abc"},
        messages=[],
    )

    result = await GroundingGuard().awrap_tool_call(request, handler)

    assert handler.called is True
    assert result.content == "read"


@pytest.mark.asyncio
async def test_missing_paper_id_in_grounding_passes_through():
    """csv_write_cell with grounding={} (no paper_id) bypasses the guard."""
    from middleware.grounding_guard import GroundingGuard  # noqa: PLC0415

    handler = AsyncMock(return_value=ToolMessage(content="written", tool_call_id="call-1"))
    request = _make_request(
        tool_name="csv_write_cell",
        tool_call_args={"grounding": {}},
        messages=[],
    )

    result = await GroundingGuard().awrap_tool_call(request, handler)

    assert handler.called is True
    assert result.content == "written"
