"""CompositeBackend — routes filesystem paths to registered sub-backends.

Routes are matched by longest-prefix-first. A route entry is a (prefix, Backend) pair.
ls("/") returns the list of all registered prefixes — the agent's root directory view.
"""
from backends.base import Backend


class CompositeBackend:
    def __init__(self, routes: list[tuple[str, Backend]]) -> None:
        # Sort longest prefix first so /a/b/ wins over /a/
        self._routes = sorted(routes, key=lambda r: len(r[0]), reverse=True)

    def _pick(self, path: str) -> Backend:
        for prefix, backend in self._routes:
            if path.startswith(prefix):
                return backend
        raise FileNotFoundError(path)

    def read(self, path: str) -> str:
        return self._pick(path).read(path)

    def write(self, path: str, content: str) -> None:
        self._pick(path).write(path, content)

    def ls(self, path: str) -> list[str]:
        if path == "/":
            return [prefix for prefix, _ in self._routes]
        return self._pick(path).ls(path)

    def delete(self, path: str) -> None:
        self._pick(path).delete(path)
