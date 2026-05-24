"""Tests for the Tavily-backed web_search tool.

web_search is a BACKUP tool — gated by per-user permission and described to
the model as "last resort, only when internal sources have failed".
"""
from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from tools import ALL_TOOLS
from tools.web_search import web_search


def test_web_search_registered_in_all_tools():
    """The tool must be discoverable via the tool registry."""
    names = [t.name for t in ALL_TOOLS]
    assert "web_search" in names


def test_web_search_docstring_marks_it_last_resort():
    """The model sees the tool description on each turn — it MUST tell the
    model this is a fallback tool, not a first choice."""
    desc = (web_search.description or "").lower()
    assert "last resort" in desc
    assert "internal documentation search has failed" in desc
    assert "specialized external search tools" in desc


def test_web_search_returns_mocked_results():
    """With TAVILY_API_KEY set, the tool delegates to TavilyClient.search()
    and returns formatted results."""
    fake_response = {
        "results": [
            {
                "title": "Attention Is All You Need",
                "url": "https://arxiv.org/abs/1706.03762",
                "content": "We propose a new simple network architecture, the Transformer.",
            },
            {
                "title": "BERT",
                "url": "https://arxiv.org/abs/1810.04805",
                "content": "BERT pre-trains deep bidirectional representations.",
            },
        ]
    }
    fake_client = MagicMock()
    fake_client.search.return_value = fake_response

    with (
        patch.dict(os.environ, {"TAVILY_API_KEY": "test-key"}, clear=False),
        patch("tools.web_search._get_client", return_value=fake_client),
    ):
        result = web_search.invoke({"query": "transformer attention paper"})

    assert "Attention Is All You Need" in result
    assert "https://arxiv.org/abs/1706.03762" in result
    assert "BERT" in result
    fake_client.search.assert_called_once()
    call_kwargs = fake_client.search.call_args.kwargs
    assert call_kwargs.get("max_results") == 5


def test_web_search_missing_key_returns_clear_error():
    """If TAVILY_API_KEY is unset, the tool returns an actionable error string
    instead of raising — so the agent can recover and tell the user."""
    with patch.dict(os.environ, {}, clear=True):
        result = web_search.invoke({"query": "anything"})
    assert "TAVILY_API_KEY" in result
    assert "not configured" in result.lower() or "missing" in result.lower()


# ---------------------------------------------------------------------------
# Permission gate — wired in km_agent.build_km_agent
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_web_search_included_when_permission_missing():
    """K12: web_search defaults ON. Missing permission means tool is bound."""
    from km_agent import _filter_tools_for_permissions

    pool = list(ALL_TOOLS)
    out = _filter_tools_for_permissions(pool, permissions={})
    names = [t.name for t in out]
    assert "web_search" in names


@pytest.mark.asyncio
async def test_web_search_included_when_permission_on():
    """Explicit True keeps web_search in the agent's tool list."""
    from km_agent import _filter_tools_for_permissions

    pool = list(ALL_TOOLS)
    out = _filter_tools_for_permissions(pool, permissions={"web_search": True})
    names = [t.name for t in out]
    assert "web_search" in names


@pytest.mark.asyncio
async def test_web_search_excluded_when_permission_explicitly_false():
    """K12: only explicit False opts out — missing/None stays default-ON."""
    from km_agent import _filter_tools_for_permissions

    pool = list(ALL_TOOLS)
    out = _filter_tools_for_permissions(pool, permissions={"web_search": False})
    names = [t.name for t in out]
    assert "web_search" not in names
