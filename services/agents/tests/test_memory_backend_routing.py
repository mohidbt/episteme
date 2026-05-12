"""RED → GREEN tests for CompositeBackend route additions in _build_memory_backend.

T2 (Phase 1.9e): /.episteme/agents/skills/ route must be wired to SkillsBackend.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


def _make_backend(user_id: str = "u"):
    from km_agent import _build_memory_backend  # noqa: PLC0415
    return _build_memory_backend(user_id=user_id, store=MagicMock())


# ---------------------------------------------------------------------------
# T2 test 1 — skills path routes to SkillsBackend
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_skills_path_routes_to_skills_backend():
    """aread on /.episteme/agents/skills/data-extract/SKILL.md must return content."""
    backend = _make_backend()
    result = await backend.aread("/.episteme/agents/skills/data-extract/SKILL.md")
    assert result.error is None, f"expected no error, got {result.error!r}"
    content = result.file_data["content"]
    assert content, "expected non-empty content from SkillsBackend"
    assert "data-extract" in content, (
        f"expected skill content, got: {content[:200]!r}"
    )


# ---------------------------------------------------------------------------
# T2 test 2 — memories path still routes to NotesBackend (regression guard)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_memories_path_still_routes_to_notes_backend(monkeypatch):
    """A read on /.episteme/agents/memories/* must actually invoke NotesBackend.aread."""
    from backends.notes_backend import NotesBackend  # noqa: PLC0415
    from deepagents.backends.protocol import FileData, ReadResult  # noqa: PLC0415

    calls: list[str] = []

    async def spy_aread(self, path, *args, **kwargs):  # noqa: ARG001
        calls.append(path)
        return ReadResult(file_data=FileData(content="spy-ok", encoding="utf-8"))

    monkeypatch.setattr(NotesBackend, "aread", spy_aread)

    backend = _make_backend(user_id="alice")
    result = await backend.aread("/.episteme/agents/memories/profile.md")

    assert calls, "NotesBackend.aread was never invoked"
    assert calls[0] == "/profile.md", (
        f"expected CompositeBackend to strip the route prefix, got {calls[0]!r}"
    )
    assert result.error is None
    assert result.file_data["content"] == "spy-ok"
