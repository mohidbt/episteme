"""Regression tests for the deepagents `glob` tool fanning into SkillsBackend
and NotesBackend.

Root cause of bug N4 (prod): the deepagents `glob` tool routes through
``CompositeBackend.aglob`` which calls ``backend.aglob(pattern, path)``. The
base ``BackendProtocol.aglob`` default delegates to ``self.glob`` which raises
``NotImplementedError``. SkillsBackend never defined ``glob`` (or ``aglob``),
so any glob touching ``/.episteme/agents/skills/...`` killed the LangGraph
stream and surfaced as "stream ended" in the UI.
"""
from __future__ import annotations

import pytest


def _make_skills(personal=None, enabled=None):
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415

    return SkillsBackend(enabled=enabled, personal_skills=personal)


# ---------------------------------------------------------------------------
# SkillsBackend.glob — sync + async — disk skills
# ---------------------------------------------------------------------------


def test_glob_recursive_returns_disk_skill_md_paths():
    """`**/SKILL.md` from root must enumerate every on-disk SKILL.md file."""
    backend = _make_skills()
    result = backend.glob("**/SKILL.md", "/")
    assert result.error is None, result.error
    paths = {m["path"] for m in (result.matches or [])}
    # Each on-disk skill (data-extract, claim-verify, deep-read, lit-triage,
    # paper-search, synthesis) must be present. Paths are reported relative to
    # the backend's virtual root (CompositeBackend strips its prefix and
    # remaps on the way back).
    expected = {
        "/data-extract/SKILL.md",
        "/claim-verify/SKILL.md",
        "/deep-read/SKILL.md",
        "/lit-triage/SKILL.md",
        "/paper-search/SKILL.md",
        "/synthesis/SKILL.md",
    }
    assert expected.issubset(paths), f"missing: {expected - paths}"
    # Underscore-prefixed directories (e.g. `_deep-read`) are hidden.
    assert not any(p.startswith("/_") for p in paths)
    assert all(not m["is_dir"] for m in result.matches)


def test_glob_respects_enabled_allowlist():
    backend = _make_skills(enabled=frozenset({"lit-triage"}))
    result = backend.glob("**/SKILL.md", "/")
    paths = {m["path"] for m in (result.matches or [])}
    assert paths == {"/lit-triage/SKILL.md"}, paths


def test_glob_includes_personal_skill_virtual_paths():
    personal = [
        {
            "slug": "my-style",
            "name": "My Style",
            "description": "personal writing style",
            "instructions": "always use serial commas",
        }
    ]
    backend = _make_skills(personal=personal, enabled=frozenset())
    result = backend.glob("**/SKILL.md", "/")
    paths = {m["path"] for m in (result.matches or [])}
    assert "/my-style/SKILL.md" in paths


@pytest.mark.asyncio
async def test_aglob_matches_glob():
    """Default `aglob` delegates via to_thread → must mirror sync output."""
    backend = _make_skills()
    sync = backend.glob("**/SKILL.md", "/")
    async_ = await backend.aglob("**/SKILL.md", "/")
    assert {m["path"] for m in (sync.matches or [])} == {
        m["path"] for m in (async_.matches or [])
    }


# ---------------------------------------------------------------------------
# NotesBackend.aglob — already implemented; lock it in so the deepagents
# `glob` tool keeps routing into memories without raising.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notes_aglob_does_not_raise_not_implemented(monkeypatch):
    """A glob against an empty memory tree must return an empty match list, not
    crash the LangGraph stream.
    """
    from backends import notes_backend as nb  # noqa: PLC0415

    async def _fake_get(path, **kwargs):
        if path == "/api/folders":
            return {"libraryId": 1, "folders": []}
        if path.startswith("/api/folders?"):
            return {"libraryId": 1, "folders": []}
        if path.startswith("/api/notes"):
            return {"notes": []}
        return {}

    async def _fake_post(path, body, **kwargs):
        if path == "/api/folders":
            return {"id": f"folder-{body['name']}", "name": body["name"]}
        return {"id": "fid-1"}

    monkeypatch.setattr(nb, "km_get", _fake_get)
    monkeypatch.setattr(nb, "km_post", _fake_post)

    backend = nb.NotesBackend(user_id="u1")
    result = await backend.aglob("**/*.md", "/")
    assert result.error is None
    assert result.matches == []
