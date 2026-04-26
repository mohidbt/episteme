"""ScratchBackend — per-thread ephemeral in-memory storage.

Each thread_id gets its own isolated namespace. All ops are synchronous since
they only touch a plain dict — no async I/O needed.

clear_thread(thread_id) is called by Task 5 route teardown to free memory.
"""
from __future__ import annotations


# Module-level registry so instances sharing the same thread_id share storage.
_STORE: dict[str, dict[str, str]] = {}


class ScratchBackend:
    def __init__(self, thread_id: str) -> None:
        self._thread_id = thread_id
        if thread_id not in _STORE:
            _STORE[thread_id] = {}

    @property
    def _ns(self) -> dict[str, str]:
        return _STORE.setdefault(self._thread_id, {})

    def read(self, path: str) -> str:
        try:
            return self._ns[path]
        except KeyError:
            raise FileNotFoundError(path)

    def write(self, path: str, content: str) -> None:
        self._ns[path] = content

    def ls(self, path: str) -> list[str]:
        return [p for p in self._ns if p.startswith(path)]

    def delete(self, path: str) -> None:
        try:
            del self._ns[path]
        except KeyError:
            raise FileNotFoundError(path)

    def clear_thread(self, thread_id: str) -> None:
        """Remove all scratch files for the given thread. Called on thread teardown."""
        _STORE.pop(thread_id, None)
