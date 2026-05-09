"""Tests for S2 query-level cache + global rate-limit circuit breaker.

Bug #22: search_papers_online always rate-limited.
We add:
- An in-memory TTL cache keyed by (query, year, limit).
- A process-wide cooldown after 429 so we stop hammering S2.
- A batch endpoint helper (/paper/batch) for multi-DOI lookups.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.search_backends import semantic_scholar as s2
from tools.search_backends.semantic_scholar import SemanticScholarSearch


S2_QUERY_RESPONSE = {
    "total": 1,
    "offset": 0,
    "data": [
        {
            "paperId": "p1",
            "title": "Some Paper",
            "authors": [{"name": "Jane Doe"}],
            "year": 2024,
            "venue": "Conf",
            "externalIds": {"DOI": "10.1/abc"},
            "openAccessPdf": {"url": "https://x/y.pdf"},
            "citationCount": 1,
            "abstract": "abstract text",
        }
    ],
}


@pytest.fixture(autouse=True)
def _reset_module_state():
    """Clear cache + cooldown between tests."""
    s2._query_cache.clear()
    s2._s2_cooldown_until = 0.0
    yield
    s2._query_cache.clear()
    s2._s2_cooldown_until = 0.0


@pytest.mark.asyncio
async def test_query_cached_second_call_no_http():
    backend = SemanticScholarSearch()
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = S2_QUERY_RESPONSE

    with patch(
        "tools.search_backends.semantic_scholar._throttled_get",
        new_callable=AsyncMock,
    ) as mock_get:
        mock_get.return_value = mock_resp
        r1 = await backend.search_by_query("attention is all", year="2024", limit=5)
        r2 = await backend.search_by_query("attention is all", year="2024", limit=5)

    assert len(r1) == 1
    assert len(r2) == 1
    assert r1[0].title == r2[0].title
    assert mock_get.call_count == 1, "second identical query must hit cache"


@pytest.mark.asyncio
async def test_query_cache_ttl_expiry_refetches():
    backend = SemanticScholarSearch()
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = S2_QUERY_RESPONSE

    state = {"now": 1000.0}

    with patch(
        "tools.search_backends.semantic_scholar._throttled_get",
        new_callable=AsyncMock,
    ) as mock_get, patch(
        "tools.search_backends.semantic_scholar.time.time",
        side_effect=lambda: state["now"],
    ):
        mock_get.return_value = mock_resp
        await backend.search_by_query("q", limit=5)
        # Advance past TTL.
        state["now"] = 1000.0 + s2._CACHE_TTL_SECONDS + 1
        await backend.search_by_query("q", limit=5)

    assert mock_get.call_count == 2, "expired entry must trigger refetch"


@pytest.mark.asyncio
async def test_429_sets_global_cooldown_skips_http():
    backend = SemanticScholarSearch()
    mock_429 = MagicMock(status_code=429, headers={"Retry-After": "60"}, text="rate limit")

    with patch(
        "tools.search_backends.semantic_scholar._throttled_get",
        new_callable=AsyncMock,
    ) as mock_get, patch(
        "tools.search_backends.semantic_scholar.asyncio.sleep",
        new_callable=AsyncMock,
    ):
        mock_get.return_value = mock_429
        # First call exhausts retries, raises S2Error, sets cooldown.
        with pytest.raises(s2.S2Error):
            await backend.search_by_query("hammered query", limit=5)

        first_call_count = mock_get.call_count
        assert s2._s2_cooldown_until > 0, "429 must set cooldown"

        # Second call within cooldown returns empty list — NO new HTTP.
        results = await backend.search_by_query("another query", limit=5)

    assert results == []
    assert mock_get.call_count == first_call_count, "no HTTP during cooldown"


