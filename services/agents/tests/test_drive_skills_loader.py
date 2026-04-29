"""Tests for the Phase 1.3f DriveSkillsLoader (skills served from drive notes)."""
from pathlib import Path

import pytest

USER = "u-1"


def test_parse_skill_md_text_works_with_in_memory_string():
    """Parser must accept a raw string (note.contentMd over HTTP) — not just a Path."""
    from skills import _parse_skill_md_text  # noqa: PLC0415

    text = """---
name: lit-triage
description: Score and bucket literature.
tools: [list_notes, search_notes]
subagents: [researcher]
require_approval: []
---

# Lit Triage Body
"""
    spec = _parse_skill_md_text(text, Path("/virtual/lit-triage/SKILL.md"))
    assert spec is not None
    assert spec.name == "lit-triage"
    assert spec.tools == ["list_notes", "search_notes"]


# ---------------------------------------------------------------------------
# Drive-backed loader: end-to-end happy path.
# ---------------------------------------------------------------------------


def _install_fake_km(monkeypatch):
    """Install in-memory fake `km_get`/`km_post` on `backends.notes_backend`.

    Returns (posts_log, notes_db, folders_db). Folders are keyed by
    (parent_id-or-None, name) for stable lookup.
    """
    posts: list[tuple[str, dict]] = []
    notes_db: list[dict] = []
    folders_db: dict[tuple[str | None, str], dict] = {}

    def _list_folders(parent_id: str | None) -> list[dict]:
        return [f for f in folders_db.values() if f["parentId"] == parent_id]

    async def fake_get(path, *, user_id):
        if path == "/api/folders":
            top = [f for f in folders_db.values() if f["parentId"] is None]
            return {"libraryId": 1, "folders": top}
        if path.startswith("/api/folders?"):
            qs = dict(p.split("=", 1) for p in path.split("?", 1)[1].split("&") if "=" in p)
            return {"libraryId": 1, "folders": _list_folders(qs.get("parentId"))}
        if path.startswith("/api/notes"):
            return list(notes_db)
        raise AssertionError(f"unexpected GET {path}")

    async def fake_post(path, body, *, user_id):
        posts.append((path, body))
        if path == "/api/folders":
            key = (body.get("parentId"), body["name"])
            if key not in folders_db:
                folders_db[key] = {
                    "id": f"folder-{body['name']}-{len(folders_db)}",
                    "name": body["name"],
                    "parentId": body.get("parentId"),
                }
            return folders_db[key]
        if path == "/api/notes":
            row = {"id": f"note-{len(notes_db) + 1}", **body}
            notes_db.append(row)
            return row
        raise AssertionError(f"unexpected POST {path}")

    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)
    return posts, notes_db, folders_db


@pytest.mark.asyncio
async def test_load_seeds_default_skills_when_drive_empty(monkeypatch):
    """First call with empty `.episteme/agents/skills/`: copy disk defaults into drive, then return."""
    from skills.drive_loader import DriveSkillsLoader  # noqa: PLC0415

    posts, notes_db, _folders = _install_fake_km(monkeypatch)

    loader = DriveSkillsLoader()
    specs = await loader.load(["lit-triage"], user_id=USER)

    assert {s.name for s in specs} == {"lit-triage"}
    seeded_notes = [b for p, b in posts if p == "/api/notes" and b.get("title") == "SKILL"]
    assert len(seeded_notes) >= 1
    assert any("lit-triage" in (b.get("contentMd") or "") for b in seeded_notes)


@pytest.mark.asyncio
async def test_load_skips_seed_when_skills_already_present(monkeypatch):
    """If a SKILL note already exists, no /api/notes POST."""
    from skills.drive_loader import DriveSkillsLoader  # noqa: PLC0415

    posts, notes_db, folders_db = _install_fake_km(monkeypatch)

    # Pre-seed: .episteme/agents/skills/lit-triage/SKILL
    def add_folder(name: str, parent_id: str | None) -> str:
        fid = f"folder-{name}-{len(folders_db)}"
        folders_db[(parent_id, name)] = {"id": fid, "name": name, "parentId": parent_id}
        return fid

    ep = add_folder(".episteme", None)
    ag = add_folder("agents", ep)
    sk = add_folder("skills", ag)
    add_folder("agents", None)  # noise — different parent
    lit = add_folder("lit-triage", sk)
    notes_db.append({
        "id": "preset-1",
        "libraryId": 1,
        "folderId": lit,
        "title": "SKILL",
        "contentMd": (
            "---\nname: lit-triage\ndescription: Pre-seeded.\n"
            "tools: []\nsubagents: []\nrequire_approval: []\n---\nbody"
        ),
    })

    loader = DriveSkillsLoader()
    specs = await loader.load(["lit-triage"], user_id=USER)

    assert specs[0].description == "Pre-seeded."
    note_posts = [p for p in posts if p[0] == "/api/notes"]
    assert note_posts == []


@pytest.mark.asyncio
async def test_user_edits_propagate_on_next_build(monkeypatch):
    """Mutating the SKILL note row → fresh loader picks up the edit."""
    from skills.drive_loader import DriveSkillsLoader  # noqa: PLC0415

    _posts, notes_db, _folders = _install_fake_km(monkeypatch)

    # First build seeds.
    specs1 = await DriveSkillsLoader().load(["lit-triage"], user_id=USER)
    seeded = next(n for n in notes_db if n.get("title") == "SKILL" and "lit-triage" in (n.get("contentMd") or ""))

    # User edits via drive UI.
    seeded["contentMd"] = (
        "---\nname: lit-triage\ndescription: USER EDITED.\n"
        "tools: [search_notes]\nsubagents: []\nrequire_approval: []\n---\nedited body"
    )

    # Fresh loader instance — mirrors agent-build lifecycle.
    specs2 = await DriveSkillsLoader().load(["lit-triage"], user_id=USER)
    assert specs1[0].description != "USER EDITED."
    assert specs2[0].description == "USER EDITED."


@pytest.mark.asyncio
async def test_unknown_skill_name_raises_keyerror(monkeypatch):
    from skills.drive_loader import DriveSkillsLoader  # noqa: PLC0415

    _install_fake_km(monkeypatch)
    with pytest.raises(KeyError):
        await DriveSkillsLoader().load(["does-not-exist"], user_id=USER)


@pytest.mark.asyncio
async def test_empty_only_returns_empty(monkeypatch):
    from skills.drive_loader import DriveSkillsLoader  # noqa: PLC0415

    _install_fake_km(monkeypatch)
    assert await DriveSkillsLoader().load([], user_id=USER) == []
