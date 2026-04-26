"""RED tests for CompositeBackend — filesystem router."""
import pytest

class _MockBackend:
    """Minimal in-memory Backend for testing routing."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._store: dict[str, str] = {}

    def read(self, path: str) -> str:
        return f"{self.name}:{path}"

    def write(self, path: str, content: str) -> None:
        self._store[path] = content

    def ls(self, path: str) -> list[str]:
        return [f"{self.name}:{path}"]

    def delete(self, path: str) -> None:
        self._store.pop(path, None)


def _make_composite(routes: list[tuple[str, _MockBackend]]):
    from backends.composite import CompositeBackend  # noqa: PLC0415
    return CompositeBackend(routes)


# ---------------------------------------------------------------------------
# Prefix routing
# ---------------------------------------------------------------------------


def test_composite_routes_to_correct_backend():
    a = _MockBackend("A")
    b = _MockBackend("B")
    comp = _make_composite([("/a/", a), ("/a/b/", b)])
    assert comp.read("/a/x.md") == "A:/a/x.md"


def test_composite_longest_prefix_wins():
    a = _MockBackend("A")
    b = _MockBackend("B")
    comp = _make_composite([("/a/", a), ("/a/b/", b)])
    assert comp.read("/a/b/x.md") == "B:/a/b/x.md"


def test_composite_unknown_prefix_raises_file_not_found():
    comp = _make_composite([("/a/", _MockBackend("A"))])
    with pytest.raises(FileNotFoundError):
        comp.read("/z/nope.md")


def test_composite_ls_root_returns_prefixes():
    a = _MockBackend("A")
    b = _MockBackend("B")
    comp = _make_composite([("/notes/", a), ("/pdfs/", b)])
    result = comp.ls("/")
    assert "/notes/" in result
    assert "/pdfs/" in result


def test_composite_write_dispatches():
    b = _MockBackend("B")
    comp = _make_composite([("/scratch/", b)])
    comp.write("/scratch/foo.md", "hello")
    assert b._store["/scratch/foo.md"] == "hello"


def test_composite_delete_dispatches():
    b = _MockBackend("B")
    b._store["/scratch/foo.md"] = "hello"
    comp = _make_composite([("/scratch/", b)])
    comp.delete("/scratch/foo.md")
    assert "/scratch/foo.md" not in b._store


def test_composite_ls_non_root_dispatches():
    a = _MockBackend("A")
    comp = _make_composite([("/notes/", a)])
    result = comp.ls("/notes/")
    assert result == ["A:/notes/"]
