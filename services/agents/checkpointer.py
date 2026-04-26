"""Checkpointer factory — MemorySaver for dev/test, AsyncPostgresSaver for prod.

Usage:
    saver = get_saver()
    agent = build_km_agent(..., saver=saver)

Set EPISTEME_AGENTS_PG_URL to a postgres connection string to use AsyncPostgresSaver.

Lifecycle: main.py lifespan opens AsyncPostgresSaver once at startup via
`async with AsyncPostgresSaver.from_conn_string(url)` and writes the instance to
_CACHED_SAVER.  get_saver() returns the cached instance if set, falling back to a
fresh MemorySaver when running in dev/test without a PG URL.
"""
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # noqa: F401 — kept for patch targets in tests

# Set by main.py lifespan when EPISTEME_AGENTS_PG_URL is configured.
_CACHED_SAVER = None


def get_saver():
    if _CACHED_SAVER is not None:
        return _CACHED_SAVER
    return MemorySaver()
