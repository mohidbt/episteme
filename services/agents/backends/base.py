"""Backend protocol for filesystem-shaped storage adapters.

Deep Agents 1.0 does not export a Backend class directly; this local
Protocol defines the shape expected by FilesystemMiddleware (read/write/ls/delete).
"""
from typing import Protocol, runtime_checkable


@runtime_checkable
class Backend(Protocol):
    def read(self, path: str) -> str: ...
    def write(self, path: str, content: str) -> None: ...
    def ls(self, path: str) -> list[str]: ...
    def delete(self, path: str) -> None: ...
