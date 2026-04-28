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

from lib.safe_store import SafeStore

# Set by main.py lifespan when EPISTEME_AGENTS_PG_URL is configured.
_CACHED_STORE = None

# Dev-mode fallback: a single InMemoryStore reused across requests so that
# /memories/ writes survive between turns and threads in dev. Without this
# every get_store() returned a brand-new store, dropping cross-thread
# persistence on the floor (mirrors the checkpointer dev-singleton fix).
_DEV_STORE = None


def get_store():
    """Return a SafeStore-wrapped BaseStore.

    SafeStore catches per-row JSON decode errors that would otherwise crash
    the agent on stale rows in the langgraph ``store`` table — see
    ``lib/safe_store.py`` for the full rationale.  Both Postgres and
    InMemoryStore go through the same wrapper for consistency.
    """
    global _DEV_STORE
    if _CACHED_STORE is not None:
        return SafeStore(_CACHED_STORE)
    if _DEV_STORE is None:
        _DEV_STORE = InMemoryStore()
    return SafeStore(_DEV_STORE)
