"""Store factory — InMemoryStore for dev/test, PostgresStore for prod.

Usage:
    store = get_store()
    agent = build_km_agent(..., store=store)

Set EPISTEME_AGENTS_PG_URL to a postgres connection string to use PostgresStore.

Lifecycle: main.py lifespan opens PostgresStore once at startup and writes the
instance to _CACHED_STORE.  get_store() returns the cached instance if set,
falling back to a fresh InMemoryStore when running in dev/test without a PG URL.
"""
import os

from langgraph.store.memory import InMemoryStore
from langgraph.store.postgres import PostgresStore  # kept for patch targets in tests

# Set by main.py lifespan when EPISTEME_AGENTS_PG_URL is configured.
_CACHED_STORE = None


def get_store():
    if _CACHED_STORE is not None:
        return _CACHED_STORE
    url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    if url:
        return PostgresStore.from_conn_string(url).__enter__()
    return InMemoryStore()
