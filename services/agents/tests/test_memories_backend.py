"""RED tests for MemoriesBackend — LangGraph BaseStore wrapper."""
import pytest
from langgraph.store.memory import InMemoryStore


def _make_backend(store: InMemoryStore, user_id: str = "user-1"):
    from backends.memories_backend import MemoriesBackend  # noqa: PLC0415
    return MemoriesBackend(store=store, user_id=user_id)


def test_write_and_read_round_trip():
    store = InMemoryStore()
    backend = _make_backend(store)
    backend.write("/memories/research-interests.md", "deep learning")
    result = backend.read("/memories/research-interests.md")
    assert result == "deep learning"


def test_read_missing_raises_file_not_found():
    store = InMemoryStore()
    backend = _make_backend(store)
    with pytest.raises(FileNotFoundError):
        backend.read("/memories/nonexistent.md")


def test_ls_returns_key_list():
    store = InMemoryStore()
    backend = _make_backend(store)
    backend.write("/memories/a.md", "a")
    backend.write("/memories/b.md", "b")
    result = backend.ls("/memories/")
    assert set(result) == {"a.md", "b.md"}


def test_delete_removes_item():
    store = InMemoryStore()
    backend = _make_backend(store)
    backend.write("/memories/x.md", "data")
    backend.delete("/memories/x.md")
    with pytest.raises(FileNotFoundError):
        backend.read("/memories/x.md")


def test_cross_instance_same_user_persistence():
    """Two MemoriesBackend instances with the same store+user share data."""
    store = InMemoryStore()
    b1 = _make_backend(store, user_id="alice")
    b2 = _make_backend(store, user_id="alice")
    b1.write("/memories/pref.md", "likes dark mode")
    result = b2.read("/memories/pref.md")
    assert result == "likes dark mode"


def test_different_users_are_isolated():
    store = InMemoryStore()
    alice = _make_backend(store, user_id="alice")
    bob = _make_backend(store, user_id="bob")
    alice.write("/memories/secret.md", "alice's data")
    with pytest.raises(FileNotFoundError):
        bob.read("/memories/secret.md")
