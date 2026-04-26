"""Store factory — InMemoryStore for dev/test, PostgresStore for prod.

Usage:
    store = get_store()
    agent = build_km_agent(..., store=store)

Set EPISTEME_AGENTS_PG_URL to a postgres connection string to use PostgresStore.
PostgresStore.from_conn_string is a context manager; we enter it here and keep
the connection open for the process lifetime (suitable for a long-running service).
"""
import os

from langgraph.store.memory import InMemoryStore
from langgraph.store.postgres import PostgresStore


def get_store() -> InMemoryStore | PostgresStore:
    url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    if url:
        return PostgresStore.from_conn_string(url).__enter__()
    return InMemoryStore()
