"""Tests for checkpointer factory.

With async PostgresSaver, get_saver() no longer initialises Postgres itself —
that's done in main.py lifespan via async with AsyncPostgresSaver.from_conn_string().
get_saver() returns _CACHED_SAVER (set by lifespan) or a fresh MemorySaver.
"""
from unittest.mock import MagicMock


def test_get_saver_returns_memory_saver_when_env_unset(monkeypatch):
    monkeypatch.delenv("EPISTEME_AGENTS_PG_URL", raising=False)
    from checkpointer import get_saver  # noqa: PLC0415

    saver = get_saver()
    from langgraph.checkpoint.memory import MemorySaver  # noqa: PLC0415

    assert isinstance(saver, MemorySaver)


def test_get_saver_returns_cached_when_set():
    """When lifespan caches an async saver, get_saver() returns it."""
    import checkpointer  # noqa: PLC0415

    fake_saver = MagicMock()
    original = checkpointer._CACHED_SAVER
    try:
        checkpointer._CACHED_SAVER = fake_saver
        result = checkpointer.get_saver()
        assert result is fake_saver
    finally:
        checkpointer._CACHED_SAVER = original


def test_get_saver_returns_memory_saver_when_cache_empty(monkeypatch):
    """Without cached saver, always returns MemorySaver regardless of env var."""
    import checkpointer  # noqa: PLC0415
    from langgraph.checkpoint.memory import MemorySaver  # noqa: PLC0415

    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgresql://u:p@host/db")
    original = checkpointer._CACHED_SAVER
    try:
        checkpointer._CACHED_SAVER = None
        result = checkpointer.get_saver()
        assert isinstance(result, MemorySaver)
    finally:
        checkpointer._CACHED_SAVER = original


def test_async_postgres_saver_importable():
    """AsyncPostgresSaver must be importable from checkpointer module namespace."""
    from checkpointer import AsyncPostgresSaver  # noqa: PLC0415
    assert AsyncPostgresSaver is not None
