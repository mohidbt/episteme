"""RED → GREEN tests for CompositeBackend route additions in _build_memory_backend.

T2 (Phase 1.9e): /.episteme/agents/skills/ route must be wired to SkillsBackend.
"""
from __future__ import annotations

import asyncio
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

def test_memories_path_still_routes_to_notes_backend():
    """/.episteme/agents/memories/ route must remain wired to NotesBackend."""
    from backends.notes_backend import NotesBackend  # noqa: PLC0415

    backend = _make_backend(user_id="alice")
    memories_backend = backend.routes.get("/.episteme/agents/memories/")
    assert memories_backend is not None, (
        "expected /.episteme/agents/memories/ in routes, not found"
    )
    assert isinstance(memories_backend, NotesBackend), (
        f"expected NotesBackend, got {type(memories_backend)!r}"
    )
    assert memories_backend.user_id == "alice"
