"""Checkpointer factory — MemorySaver for dev/test, PostgresSaver for prod.

Usage:
    saver = get_saver()
    agent = build_km_agent(..., saver=saver)

Set EPISTEME_AGENTS_PG_URL to a postgres connection string to use PostgresSaver.
PostgresSaver.from_conn_string is a context manager; we enter it here and keep
the connection open for the process lifetime (suitable for a long-running service).
"""
import os

from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres import PostgresSaver


def get_saver() -> MemorySaver | PostgresSaver:
    url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    if url:
        return PostgresSaver.from_conn_string(url).__enter__()
    return MemorySaver()
