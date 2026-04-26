"""Store factory — InMemoryStore for dev/test, AsyncPostgresStore for prod.

Usage:
    store = get_store()
    agent = build_km_agent(..., store=store)

Set EPISTEME_AGENTS_PG_URL to a postgres connection string to use AsyncPostgresStore.

Lifecycle: main.py lifespan opens AsyncPostgresStore once at startup via
`async with AsyncPostgresStore.from_conn_string(url)` and writes the instance to
_CACHED_STORE.  get_store() returns the cached instance if set, falling back to a
fresh InMemoryStore when running in dev/test without a PG URL.
"""
from langgraph.store.memory import InMemoryStore
from langgraph.store.postgres.aio import AsyncPostgresStore  # noqa: F401 — kept for patch targets in tests

# Set by main.py lifespan when EPISTEME_AGENTS_PG_URL is configured.
_CACHED_STORE = None


def get_store():
    if _CACHED_STORE is not None:
        return _CACHED_STORE
    return InMemoryStore()
