"""Pre/post benchmark for S2 hardening (plan: temporal-wibbling-robin).

Run as:
    cd services/agents && uv run pytest tests/test_s2_hardening_bench.py -v -s

The `-s` flag is important: each test prints a [METRIC] line so we can diff
baseline vs post-fix numbers.

Three target metrics:
  M1 — number of HTTP attempts when S2 returns persistent 429 (unauth).
       baseline expectation: 4 (1 + 3 retries)
       target:               1 (no retries, trip cooldown immediately)

  M2 — total simulated sleep seconds in the same scenario.
       baseline expectation: 3 + 6 + 12 = 21s
       target:               0s

  M3 — query length passed to S2 from `search_papers_online` for a
       20-token query.
       baseline expectation: 20 tokens passed through verbatim
       target:               <=10 tokens

  M4 — cross-process cooldown propagation (Postgres-backed). Baseline:
       trip in process A, process B is unaware (returns False). Target:
       process B sees the cooldown.

Tests assert TARGET behaviour. Pre-fix: the first three FAIL (RED);
M4 is xfail until the cooldown store lands. Post-fix: all GREEN.
"""
from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# M1 + M2 — retry count and wall-time on persistent 429 (unauth path)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_m1_m2_no_retry_on_429_when_unauthenticated():
    from tools.search_backends import semantic_scholar as s2

    # Force unauth path regardless of dev env.
    s2._api_key = None
    # Reset cooldown so the test is deterministic.
    s2._s2_cooldown_until = 0.0
    s2._query_cache.clear()

    mock_429 = MagicMock()
    mock_429.status_code = 429
    mock_429.headers = {}
    mock_429.text = "Too Many Requests"

    sleep_total = 0.0

    async def fake_sleep(seconds: float) -> None:
        nonlocal sleep_total
        sleep_total += seconds

    with patch.object(s2, "_throttled_get", new_callable=AsyncMock) as mock_get, \
         patch.object(s2.asyncio, "sleep", side_effect=fake_sleep):
        mock_get.return_value = mock_429
        try:
            await s2.SemanticScholarSearch().search_by_query("anything", limit=5)
        except s2.S2Error:
            pass  # expected on persistent 429

        attempts = mock_get.call_count

    print(f"\n[METRIC M1] http_attempts_on_persistent_429_unauth = {attempts}")
    print(f"[METRIC M2] simulated_sleep_seconds                  = {sleep_total:.1f}s")

    # TARGET assertions — post-fix.
    assert attempts == 1, f"unauth should fast-fail; got {attempts} attempts"
    assert sleep_total == 0.0, f"unauth should not sleep; slept {sleep_total}s"


@pytest.mark.asyncio
async def test_authed_still_retries_three_times():
    """Authenticated path keeps the 3-retry behaviour."""
    from tools.search_backends import semantic_scholar as s2

    s2._api_key = "fake-key-for-test"
    s2._s2_cooldown_until = 0.0
    s2._query_cache.clear()

    mock_429 = MagicMock()
    mock_429.status_code = 429
    mock_429.headers = {}
    mock_429.text = "Too Many Requests"

    with patch.object(s2, "_throttled_get", new_callable=AsyncMock) as mock_get, \
         patch.object(s2.asyncio, "sleep", new_callable=AsyncMock):
        mock_get.return_value = mock_429
        try:
            await s2.SemanticScholarSearch().search_by_query("anything", limit=5)
        except s2.S2Error:
            pass
        attempts = mock_get.call_count

    s2._api_key = None  # restore for other tests
    print(f"\n[METRIC] http_attempts_on_persistent_429_authed = {attempts}")
    assert attempts == 4, f"authed path should retry 3x (4 total); got {attempts}"


# ---------------------------------------------------------------------------
# M3 — query length cap in search_papers_online
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_m3_search_papers_online_caps_query_length():
    from tools import paper_search

    long_query = " ".join(["bert", "pretraining", "deep", "bidirectional",
                           "transformers", "language", "understanding", "elmo",
                           "gpt", "roberta", "xlnet", "albert", "masked",
                           "language", "model", "2018", "2019", "similar",
                           "papers", "neural"])
    seen_queries: list[str] = []

    async def fake_search(self, query, year=None, limit=5):
        seen_queries.append(query)
        return []

    with patch.object(
        paper_search.SemanticScholarSearch,
        "search_by_query",
        new=fake_search,
    ):
        await paper_search.search_papers_online.ainvoke({"query": long_query})

    assert seen_queries, "search_by_query was not called"
    out_tokens = seen_queries[0].split()
    print(f"\n[METRIC M3] outbound_query_tokens (input=20) = {len(out_tokens)}")
    assert len(out_tokens) <= 10, (
        f"long queries should be capped to <=10 tokens; got {len(out_tokens)}"
    )


# ---------------------------------------------------------------------------
# M4 — cross-process cooldown propagation (Postgres-backed)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_m4_cooldown_propagates_across_process_boundary():
    """Process A trips cooldown → process B sees it on next check.

    We simulate "process B" by clearing the in-memory module global and
    asking `_in_cooldown` again — it must consult the shared store and
    re-hydrate.
    """
    from tools.search_backends import semantic_scholar as s2

    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set; cooldown store has no backend")

    from deps import db as db_module
    from tools.search_backends import _cooldown_store

    await db_module.init_pool()
    if db_module._pool is None:
        pytest.skip("could not init asyncpg pool")
    # Reset shared-store state so the test is deterministic.
    _cooldown_store._initialised = False
    try:
        async with db_module._pool.acquire() as conn:
            await conn.execute("DROP TABLE IF EXISTS s2_cooldown")
    except Exception:
        pass

    s2._s2_cooldown_until = 0.0
    s2._query_cache.clear()

    # Simulate: process A trips the cooldown (60s).
    await s2._trip_cooldown(60.0)  # type: ignore[misc]
    print(f"\n[METRIC M4a] in_cooldown_after_trip(processA) = {await s2._in_cooldown()}")

    # Simulate process B: zero out the local cache, query again.
    s2._s2_cooldown_until = 0.0
    in_cd = await s2._in_cooldown()  # type: ignore[misc]
    print(f"[METRIC M4b] in_cooldown_after_local_cache_wipe(processB) = {in_cd}")

    await db_module.close_pool()
    assert in_cd, "cooldown must propagate across process via shared store"
