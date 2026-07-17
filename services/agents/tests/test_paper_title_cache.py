"""Tests for the in-process paper-title cache TTL (A3).

Bug: ``_PAPER_TITLE_CACHE`` was a process-wide FIFO with no expiry, so a
title rename in KM was invisible to the agent until process restart. We add
a 60-second monotonic TTL: entries older than the TTL are evicted on read
and re-fetched from the DB.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from tools import papers


@pytest.fixture(autouse=True)
def _reset_cache():
    papers._PAPER_TITLE_CACHE.clear()
    yield
    papers._PAPER_TITLE_CACHE.clear()


@pytest.mark.asyncio
async def test_title_cache_ttl_expires_after_60s(monkeypatch):
    """t=0 fetch; t=30s cache hit; t=61s cache miss (re-fetch)."""
    conn = MagicMock()
    # First DB call returns the old title, second returns the renamed one
    # so we can also confirm post-expiry re-fetch picks up fresh data.
    conn.fetchrow = AsyncMock(
        side_effect=[
            {"title": "Old Title"},
            {"title": "New Title"},
        ]
    )

    state = {"now": 1000.0}
    monkeypatch.setattr(papers.time, "monotonic", lambda: state["now"])

    # t=0: cold fetch
    t1 = await papers._get_paper_title(conn, "paper-1", "user-1")
    assert t1 == "Old Title"
    assert conn.fetchrow.call_count == 1

    # t=30s: still within TTL → cache hit, no new DB call
    state["now"] = 1000.0 + 30
    t2 = await papers._get_paper_title(conn, "paper-1", "user-1")
    assert t2 == "Old Title"
    assert conn.fetchrow.call_count == 1, "30s in: must hit cache"

    # t=61s: past 60s TTL → re-fetch from DB
    state["now"] = 1000.0 + 61
    t3 = await papers._get_paper_title(conn, "paper-1", "user-1")
    assert conn.fetchrow.call_count == 2, "past TTL: must re-fetch"
    assert t3 == "New Title"
