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


# ---------------------------------------------------------------------------
# Phase 1.3e Task 4 — nested awrite + aedit (PATCH)
# ---------------------------------------------------------------------------


def _make_fake_km(notes_db: list[dict], calls: list[tuple[str, str, dict | None]]):
    """Build (fake_get, fake_post, fake_patch) trio sharing notes_db + calls log."""

    async def fake_get(path, *, user_id):
        calls.append(("GET", path, None))
        if path == "/api/folders":
            return {"libraryId": 1, "folders": []}
        if path.startswith("/api/folders?"):
            return {"libraryId": 1, "folders": []}
        if path.startswith("/api/notes?") or path == "/api/notes":
            return list(notes_db)
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

    async def fake_patch(path, body, *, user_id):
        calls.append(("PATCH", path, body))
        # /api/notes/<id>
        prefix = "/api/notes/"
        assert path.startswith(prefix), f"unexpected PATCH {path}"
        note_id = path[len(prefix):]
        for row in notes_db:
            if row["id"] == note_id:
                row.update(body)
                return row
        return {"error": "not_found"}

    return fake_get, fake_post, fake_patch


@pytest.mark.asyncio
async def test_awrite_nested_creates_subfolder_under_memories(monkeypatch):
    notes_db: list[dict] = []
    calls: list[tuple[str, str, dict | None]] = []
    fake_get, fake_post, fake_patch = _make_fake_km(notes_db, calls)
    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_patch", fake_patch, raising=False)

    backend = _make_backend()
    result = await backend.awrite("/research/transformers.md", "v1")
    assert result.error is None

    folder_posts = [c for c in calls if c[0] == "POST" and c[1] == "/api/folders"]
    assert [p[2]["name"] for p in folder_posts] == [
        ".episteme",
        "agents",
        "memories",
        "research",
    ]
    # research is created under memories
    research_post = folder_posts[3][2]
    assert research_post["parentId"] == "folder-memories"

    note_posts = [c for c in calls if c[0] == "POST" and c[1] == "/api/notes"]
    assert len(note_posts) == 1
    body = note_posts[0][2]
    assert body["folderId"] == "folder-research"
    assert body["title"] == "transformers"

    # Second nested write under same /research/ — must reuse cached folder chain.
    folder_calls_before = sum(
        1
        for c in calls
        if c[1].startswith("/api/folders") and c[0] in ("GET", "POST")
    )
    result2 = await backend.awrite("/research/other.md", "v2")
    assert result2.error is None
    folder_calls_after = sum(
        1
        for c in calls
        if c[1].startswith("/api/folders") and c[0] in ("GET", "POST")
    )
    assert folder_calls_after == folder_calls_before, (
        "second nested write must hit cache — no extra /api/folders GET/POST. "
        f"got {folder_calls_after - folder_calls_before} extra."
    )


@pytest.mark.asyncio
async def test_aedit_replaces_string_in_existing_note(monkeypatch):
    notes_db: list[dict] = []
    calls: list[tuple[str, str, dict | None]] = []
    fake_get, fake_post, fake_patch = _make_fake_km(notes_db, calls)
    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_patch", fake_patch, raising=False)

    backend = _make_backend()
    write = await backend.awrite("/preferences.md", "I prefer concise responses.")
    assert write.error is None

    edit = await backend.aedit("/preferences.md", "concise", "verbose")
    assert edit.error is None
    assert edit.occurrences == 1

    patches = [c for c in calls if c[0] == "PATCH"]
    assert len(patches) == 1
    assert patches[0][1] == f"/api/notes/{notes_db[0]['id']}"
    assert patches[0][2]["contentMd"] == "I prefer verbose responses."

    # Read back — content updated.
    read = await backend.aread("/preferences.md")
    assert read.error is None
    assert read.file_data is not None
    assert read.file_data["content"] == "I prefer verbose responses."


@pytest.mark.asyncio
async def test_aedit_replace_first_only_by_default(monkeypatch):
    notes_db: list[dict] = []
    calls: list[tuple[str, str, dict | None]] = []
    fake_get, fake_post, fake_patch = _make_fake_km(notes_db, calls)
    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_patch", fake_patch, raising=False)

    backend = _make_backend()
    await backend.awrite("/notes.md", "foo bar foo bar foo")

    edit = await backend.aedit("/notes.md", "foo", "BAZ")
    assert edit.error is None
    assert edit.occurrences == 1
    assert notes_db[0]["contentMd"] == "BAZ bar foo bar foo"


@pytest.mark.asyncio
async def test_aedit_replace_all(monkeypatch):
    notes_db: list[dict] = []
    calls: list[tuple[str, str, dict | None]] = []
    fake_get, fake_post, fake_patch = _make_fake_km(notes_db, calls)
    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_patch", fake_patch, raising=False)

    backend = _make_backend()
    await backend.awrite("/notes.md", "foo bar foo bar foo")

    edit = await backend.aedit("/notes.md", "foo", "BAZ", replace_all=True)
    assert edit.error is None
    assert edit.occurrences == 3
    assert notes_db[0]["contentMd"] == "BAZ bar BAZ bar BAZ"


@pytest.mark.asyncio
async def test_aedit_file_not_found(monkeypatch):
    notes_db: list[dict] = []
    calls: list[tuple[str, str, dict | None]] = []
    fake_get, fake_post, fake_patch = _make_fake_km(notes_db, calls)
    monkeypatch.setattr("backends.notes_backend.km_get", fake_get, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_post", fake_post, raising=False)
    monkeypatch.setattr("backends.notes_backend.km_patch", fake_patch, raising=False)

    backend = _make_backend()
    edit = await backend.aedit("/nope.md", "a", "b")
    assert edit.error == "file_not_found"
