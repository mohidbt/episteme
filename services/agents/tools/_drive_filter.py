"""Helpers to hide agent-managed `.episteme/**` rows from drive-listing tools.

The `.episteme/` folder tree (memories, skills) is internal to the agent and
must never appear in user-facing listings produced by `list_pdfs`,
`list_references`, etc. (+44).
"""
from __future__ import annotations

from typing import Any


def _is_hidden_folder_path(path: Any) -> bool:
    if not isinstance(path, str):
        return False
    return path == ".episteme" or path.startswith(".episteme/")


def filter_hidden(rows: Any) -> Any:
    """Drop rows whose ``folderPath`` is under `.episteme/**`.

    Non-list inputs (e.g. error dicts) are returned unchanged so error paths
    keep their structured shape.
    """
    if not isinstance(rows, list):
        return rows
    return [r for r in rows if not _is_hidden_folder_path(
        (r or {}).get("folderPath") if isinstance(r, dict) else None
    )]
