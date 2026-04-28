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
