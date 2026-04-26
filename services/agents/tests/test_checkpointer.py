"""RED tests for checkpointer factory."""
from unittest.mock import MagicMock, patch


def test_get_saver_returns_memory_saver_when_env_unset(monkeypatch):
    monkeypatch.delenv("EPISTEME_AGENTS_PG_URL", raising=False)
    from checkpointer import get_saver  # noqa: PLC0415

    saver = get_saver()
    from langgraph.checkpoint.memory import MemorySaver  # noqa: PLC0415

    assert isinstance(saver, MemorySaver)


def test_get_saver_calls_postgres_when_env_set(monkeypatch):
    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgresql://u:p@host/db")
    fake_saver = MagicMock()
    fake_cm = MagicMock()
    fake_cm.__enter__ = MagicMock(return_value=fake_saver)
    fake_cm.__exit__ = MagicMock(return_value=False)

    with patch("checkpointer.PostgresSaver.from_conn_string", return_value=fake_cm) as mock_fn:
        from importlib import reload  # noqa: PLC0415
        import checkpointer  # noqa: PLC0415

        reload(checkpointer)
        result = checkpointer.get_saver()

    mock_fn.assert_called_once_with("postgresql://u:p@host/db")
    assert result is fake_saver
