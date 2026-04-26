"""RED tests for store factory."""
from unittest.mock import MagicMock, patch


def test_get_store_returns_inmemory_when_env_unset(monkeypatch):
    monkeypatch.delenv("EPISTEME_AGENTS_PG_URL", raising=False)
    from store import get_store  # noqa: PLC0415

    s = get_store()
    from langgraph.store.memory import InMemoryStore  # noqa: PLC0415

    assert isinstance(s, InMemoryStore)


def test_get_store_calls_postgres_when_env_set(monkeypatch):
    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgresql://u:p@host/db")
    fake_store = MagicMock()
    fake_cm = MagicMock()
    fake_cm.__enter__ = MagicMock(return_value=fake_store)
    fake_cm.__exit__ = MagicMock(return_value=False)

    with patch("store.PostgresStore.from_conn_string", return_value=fake_cm) as mock_fn:
        from importlib import reload  # noqa: PLC0415
        import store  # noqa: PLC0415

        reload(store)
        result = store.get_store()

    mock_fn.assert_called_once_with("postgresql://u:p@host/db")
    assert result is fake_store
