"""Tests for store factory.

With async PostgresStore, get_store() no longer initialises Postgres itself —
that's done in main.py lifespan via async with AsyncPostgresStore.from_conn_string().
get_store() returns _CACHED_STORE (set by lifespan) or a fresh InMemoryStore.
"""
from unittest.mock import MagicMock


def test_get_store_returns_inmemory_when_env_unset(monkeypatch):
    monkeypatch.delenv("EPISTEME_AGENTS_PG_URL", raising=False)
    from store import get_store  # noqa: PLC0415

    s = get_store()
    from langgraph.store.memory import InMemoryStore  # noqa: PLC0415
    from lib.safe_store import SafeStore  # noqa: PLC0415

    assert isinstance(s, SafeStore)
    assert isinstance(s._inner, InMemoryStore)


def test_get_store_returns_cached_when_set():
    """When lifespan caches an async store, get_store() wraps it in SafeStore."""
    import store  # noqa: PLC0415
    from lib.safe_store import SafeStore  # noqa: PLC0415

    fake_store = MagicMock()
    original = store._CACHED_STORE
    try:
        store._CACHED_STORE = fake_store
        result = store.get_store()
        assert isinstance(result, SafeStore)
        assert result._inner is fake_store
    finally:
        store._CACHED_STORE = original


def test_get_store_returns_inmemory_when_cache_empty(monkeypatch):
    """Without cached store, always returns SafeStore-wrapped InMemoryStore regardless of env var."""
    import store  # noqa: PLC0415
    from langgraph.store.memory import InMemoryStore  # noqa: PLC0415
    from lib.safe_store import SafeStore  # noqa: PLC0415

    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgresql://u:p@host/db")
    original = store._CACHED_STORE
    try:
        store._CACHED_STORE = None
        result = store.get_store()
        assert isinstance(result, SafeStore)
        assert isinstance(result._inner, InMemoryStore)
    finally:
        store._CACHED_STORE = original


def test_async_postgres_store_importable():
    """AsyncPostgresStore must be importable from store module namespace."""
    from store import AsyncPostgresStore  # noqa: PLC0415
    assert AsyncPostgresStore is not None
