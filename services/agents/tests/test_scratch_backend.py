"""RED tests for ScratchBackend — per-thread in-memory dict."""
import pytest


def _make_backend(thread_id: str = "thread-1"):
    from backends.scratch_backend import ScratchBackend  # noqa: PLC0415
    return ScratchBackend(thread_id=thread_id)


def test_write_and_read_round_trip():
    backend = _make_backend("t-rw")
    backend.write("/scratch/draft.md", "hello world")
    assert backend.read("/scratch/draft.md") == "hello world"


def test_read_missing_raises_file_not_found():
    backend = _make_backend("t-miss")
    with pytest.raises(FileNotFoundError):
        backend.read("/scratch/missing.md")


def test_ls_returns_paths_in_thread():
    backend = _make_backend("t-ls")
    backend.write("/scratch/a.md", "a")
    backend.write("/scratch/b.md", "b")
    result = backend.ls("/scratch/")
    assert set(result) == {"/scratch/a.md", "/scratch/b.md"}


def test_delete_removes_file():
    backend = _make_backend("t-del")
    backend.write("/scratch/x.md", "data")
    backend.delete("/scratch/x.md")
    with pytest.raises(FileNotFoundError):
        backend.read("/scratch/x.md")


def test_clear_thread_empties_storage():
    backend = _make_backend("t-clear")
    backend.write("/scratch/a.md", "data")
    backend.clear_thread("t-clear")
    with pytest.raises(FileNotFoundError):
        backend.read("/scratch/a.md")


def test_different_thread_ids_are_isolated():
    b1 = _make_backend("thread-A")
    b2 = _make_backend("thread-B")
    b1.write("/scratch/secret.md", "A data")
    with pytest.raises(FileNotFoundError):
        b2.read("/scratch/secret.md")


def test_clear_thread_only_affects_target_thread():
    b1 = _make_backend("thread-A")
    b2 = _make_backend("thread-B")
    b1.write("/scratch/a.md", "keep")
    b2.write("/scratch/a.md", "clear me")
    b2.clear_thread("thread-B")
    # b1 should be unaffected
    assert b1.read("/scratch/a.md") == "keep"
