"""Checkpointer factory — MemorySaver for dev/test, PostgresSaver for prod.

Usage:
    saver = get_saver()
    agent = build_km_agent(..., saver=saver)

Set EPISTEME_AGENTS_PG_URL to a postgres connection string to use PostgresSaver.

Lifecycle: main.py lifespan opens PostgresSaver once at startup and writes the
instance to _CACHED_SAVER.  get_saver() returns the cached instance if set,
falling back to a fresh MemorySaver when running in dev/test without a PG URL.
"""
import os

from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres import PostgresSaver  # kept for patch targets in tests

# Set by main.py lifespan when EPISTEME_AGENTS_PG_URL is configured.
_CACHED_SAVER = None


def get_saver():
    if _CACHED_SAVER is not None:
        return _CACHED_SAVER
    url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    if url:
        return PostgresSaver.from_conn_string(url).__enter__()
    return MemorySaver()
