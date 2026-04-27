"""MemoriesBackend — filesystem-shaped adapter over LangGraph BaseStore.

Namespace used: ("memories", user_id) — one namespace per user.
Values are stored as {"content": str} dicts in the store.

Paths:
  /memories/<key>  — individual memory item (key is the path basename)
  /memories/       — directory listing (returns list of "<key>" strings)
"""
from langgraph.store.base import BaseStore


class MemoriesBackend:
    def __init__(self, store: BaseStore, user_id: str) -> None:
        self._store = store
        self._ns = ("memories", user_id)

    def _key(self, path: str) -> str:
        return path.removeprefix("/memories/")

    def read(self, path: str) -> str:
        key = self._key(path)
        item = self._store.get(self._ns, key)
        if item is None:
            raise FileNotFoundError(path)
        return item.value["content"]

    def write(self, path: str, content: str) -> None:
        key = self._key(path)
        self._store.put(self._ns, key, {"content": content})

    def ls(self, path: str) -> list[str]:
        results = self._store.search(self._ns)
        return [item.key for item in results]

    def delete(self, path: str) -> None:
        key = self._key(path)
        self._store.delete(self._ns, key)
