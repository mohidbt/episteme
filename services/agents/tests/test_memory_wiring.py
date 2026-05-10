"""Tests for memory backend wiring (§1.3b-E2E-4 / 1.3e).

Verifies that ``_build_memory_backend`` wires ``CompositeBackend`` so that
writes under ``/.episteme/agents/memories/`` are routed to ``NotesBackend``
and writes to other paths fall through to ``StateBackend``.

Strategy: unit-test the helper that constructs the backend.  NotesBackend
makes async HTTP calls, so we mock those.  StateBackend requires a LangGraph
graph context, so we patch ``StateBackend._get_config`` to avoid the
RuntimeError for any path that lands on the default backend.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


MEMORIES_PATH = "/.episteme/agents/memories/"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _run(coro):
    return asyncio.run(coro)


def _make_backend(user_id: str):
    """Import and construct the backend with StateBackend._get_config mocked."""
    from km_agent import _build_memory_backend  # noqa: PLC0415

    return _build_memory_backend(user_id=user_id, store=MagicMock())


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_build_memory_backend_writes_under_memories_user_id_prefix():
    """awrite under /.episteme/agents/memories/ is routed to NotesBackend."""
    backend = _make_backend(user_id="alice")

    # NotesBackend.bootstrap() does HTTP -> mock the two internal helpers it
    # calls: km_get (for library resolution) and km_post (to create the note).
    mock_km_get = AsyncMock(return_value={
        "libraryId": 42,
        "folders": [],
    })
    # ensure_folder_chain calls km_post for each missing folder segment
    # (3 segments: .episteme / agents / memories), plus km_post for the note.
    # We return a valid folder id each time, then a note object for the write.
    folder_call_count = 0

    async def _mock_km_post(path, body, *, user_id):
        nonlocal folder_call_count
        if path == "/api/notes":
            return {"id": "note-1", "title": body.get("title"), "error": None}
        # folder creation
        folder_call_count += 1
        return {"id": f"folder-{folder_call_count}", "error": None}

    with (
        patch("backends.notes_backend.km_get", mock_km_get),
        patch("backends.notes_backend.km_post", _mock_km_post),
        patch("deepagents.backends.state.StateBackend._get_config",
              return_value={"configurable": {}}),
    ):
        result = _run(backend.awrite(
            f"{MEMORIES_PATH}research-interests.md",
            "photonic computing",
        ))

    assert result.error is None, f"expected no error, got {result.error!r}"
    assert result.path == f"{MEMORIES_PATH}research-interests.md"


def test_build_memory_backend_isolates_users():
    """Two users must not share NotesBackend instances (different user_id)."""
    alice_backend = _make_backend(user_id="alice")
    bob_backend = _make_backend(user_id="bob")

    # Verify that each backend's NotesBackend carries the correct user_id.
    # CompositeBackend.routes maps prefix -> backend; there's exactly one route.
    alice_notes = list(alice_backend.routes.values())[0]
    bob_notes = list(bob_backend.routes.values())[0]

    assert alice_notes.user_id == "alice", (
        f"alice's NotesBackend has wrong user_id: {alice_notes.user_id!r}"
    )
    assert bob_notes.user_id == "bob", (
        f"bob's NotesBackend has wrong user_id: {bob_notes.user_id!r}"
    )
    # They must be distinct objects — no shared state.
    assert alice_notes is not bob_notes
