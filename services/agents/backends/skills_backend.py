"""SkillsBackend — read-only view of on-disk skills/ directory.

Implements the subset of BackendProtocol needed by SkillsMiddleware._alist_skills
and FilesystemMiddleware.read_file:
  - ls(path)             → LsResult with skill dir entries (is_dir=True)
  - download_files(paths)→ batch SKILL.md bytes
  - read(path)           → single-file ReadResult
  - write(...)           → always PermissionError (read-only)

The virtual path root is /.episteme/agents/skills/ which maps to the
on-disk services/agents/skills/ directory. Dirs prefixed with _ are skipped.
"""
from __future__ import annotations

from pathlib import Path

from deepagents.backends.protocol import (
    BackendProtocol,
    FileData,
    FileDownloadResponse,
    FileInfo,
    LsResult,
    ReadResult,
    WriteResult,
)

_VIRTUAL_ROOT = "/.episteme/agents/skills"
_DISK_ROOT = Path(__file__).resolve().parent.parent / "skills"


def _virtual_to_disk(virtual_path: str) -> Path:
    relative = virtual_path.removeprefix(_VIRTUAL_ROOT).lstrip("/")
    return _DISK_ROOT / relative


class SkillsBackend(BackendProtocol):
    """Read-only backend backed by services/agents/skills/ on disk."""

    def ls(self, path: str) -> LsResult:
        disk_dir = _virtual_to_disk(path)
        if not disk_dir.is_dir():
            return LsResult(error=f"not a directory: {path}")

        entries: list[FileInfo] = []
        for child in sorted(disk_dir.iterdir()):
            if not child.is_dir() or child.name.startswith("_"):
                continue
            virtual_child = path.rstrip("/") + "/" + child.name + "/"
            entries.append(FileInfo(path=virtual_child, is_dir=True))
        return LsResult(entries=entries)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        disk_path = _virtual_to_disk(file_path)
        if not disk_path.is_file():
            return ReadResult(error="file_not_found")
        content = disk_path.read_text(encoding="utf-8")
        return ReadResult(file_data=FileData(content=content, encoding="utf-8"))

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        results = []
        for path in paths:
            disk_path = _virtual_to_disk(path)
            if not disk_path.is_file():
                results.append(FileDownloadResponse(path=path, error="file_not_found"))
            else:
                results.append(FileDownloadResponse(path=path, content=disk_path.read_bytes()))
        return results

    def write(self, file_path: str, content: str) -> WriteResult:
        raise PermissionError("SkillsBackend is read-only")
