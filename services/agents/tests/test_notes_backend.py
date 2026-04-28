"""Tests for the Phase 1.3e NotesBackend (deepagents BackendProtocol).

The legacy tool-wrapping NotesBackend (read/write/ls over the notes tool
registry) was removed in Phase 1.3e Task 2 — its tests went with it.
"""
import pytest

USER = "user_test_1"


def _make_backend(user_id: str = USER):
    from backends.notes_backend import NotesBackend  # noqa: PLC0415
    return NotesBackend(user_id=user_id)


# ---------------------------------------------------------------------------
# Phase 1.3e — bootstrap awrite under /.episteme/agents/memories/
# ---------------------------------------------------------------------------
#
# The new NotesBackend (deepagents BackendProtocol) must, on first awrite:
#   1. resolve the user's default library — uses GET /api/folders with no
#      libraryId; the HMAC path returns {libraryId, folders}.
#   2. ensure .episteme → agents → memories chain via POST /api/folders.
#   3. POST /api/notes with {libraryId, folderId, title, contentMd}.
# Mounted under CompositeBackend route /.episteme/agents/memories/, so
# paths arriving here look like /preferences.md (route prefix is stripped).


@pytest.mark.asyncio
async def test_awrite_bootstrap_creates_episteme_agents_memories_chain(monkeypatch):
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_get(path, *, user_id):
        calls.append(("GET", path, None))
        # Bootstrap: omit libraryId — HMAC path resolves user's default library.
        if path == "/api/folders":
            return {"libraryId": 1, "folders": []}
        # Subsequent listing scoped to libraryId for chain walk.
        if path.startswith("/api/folders?"):
            return {"libraryId": 1, "folders": []}
        raise AssertionError(f"unexpected GET {path}")

    async def fake_post(path, body, *, user_id):
        calls.append(("POST", path, body))
        if path == "/api/folders":
            return {
                "id": f"folder-{body['name']}",
                "name": body["name"],
                "parentId": body.get("parentId"),
            }
        if path == "/api/notes":
            return {"id": "note-1", "title": body["title"]}
        raise AssertionError(f"unexpected POST {path}")

    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)

    backend = _make_backend()
    result = await backend.awrite("/preferences.md", "I prefer concise responses.")

    # WriteResult signals success via error == None (deepagents protocol).
    assert result.error is None

    folder_posts = [c for c in calls if c[0] == "POST" and c[1] == "/api/folders"]
    assert [p[2]["name"] for p in folder_posts] == [".episteme", "agents", "memories"]
    # parentId chain: root → .episteme → agents.
    assert folder_posts[0][2]["parentId"] is None
    assert folder_posts[1][2]["parentId"] == "folder-.episteme"
    assert folder_posts[2][2]["parentId"] == "folder-agents"
    assert all(p[2]["libraryId"] == 1 for p in folder_posts)

    note_posts = [c for c in calls if c[0] == "POST" and c[1] == "/api/notes"]
    assert len(note_posts) == 1
    body = note_posts[0][2]
    assert body["folderId"] == "folder-memories"
    assert body["libraryId"] == 1
    assert body["title"] == "preferences"
    assert body["contentMd"] == "I prefer concise responses."


# ---------------------------------------------------------------------------
# Phase 1.3e Task 3 — aread + folder cache reuse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_aread_returns_content_after_awrite_uses_cache(monkeypatch):
    """aread after awrite must hit the folder cache: no re-walk of /api/folders."""
    notes_db: list[dict] = []
    calls: list[tuple[str, str]] = []

    async def fake_get(path, *, user_id):
        calls.append(("GET", path))
        if path == "/api/folders":
            return {"libraryId": 1, "folders": []}
        if path.startswith("/api/folders?"):
            return {"libraryId": 1, "folders": []}
        if path.startswith("/api/notes?") or path == "/api/notes":
            # Return all notes for this library — backend filters client-side.
            return list(notes_db)
        raise AssertionError(f"unexpected GET {path}")

    async def fake_post(path, body, *, user_id):
        if path == "/api/folders":
            return {
                "id": f"folder-{body['name']}",
                "name": body["name"],
                "parentId": body.get("parentId"),
            }
        if path == "/api/notes":
            row = {
                "id": f"note-{len(notes_db) + 1}",
                "libraryId": body["libraryId"],
                "folderId": body.get("folderId"),
                "title": body["title"],
                "contentMd": body["contentMd"],
            }
            notes_db.append(row)
            return row
        raise AssertionError(f"unexpected POST {path}")

    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)

    backend = _make_backend()
    write = await backend.awrite("/preferences.md", "v1")
    assert write.error is None

    # Snapshot folder GET count after bootstrap.
    folder_gets_after_write = sum(
        1 for kind, p in calls if kind == "GET" and p.startswith("/api/folders")
    )
    assert folder_gets_after_write >= 1, "bootstrap should have hit /api/folders at least once"

    read = await backend.aread("/preferences.md")
    assert read.error is None
    assert read.file_data is not None
    assert read.file_data["content"] == "v1"

    # Cache hit — no additional /api/folders GETs after the read.
    folder_gets_after_read = sum(
        1 for kind, p in calls if kind == "GET" and p.startswith("/api/folders")
    )
    assert folder_gets_after_read == folder_gets_after_write, (
        "aread must reuse cached folder chain — no extra /api/folders calls. "
        f"got {folder_gets_after_read - folder_gets_after_write} extra."
    )
