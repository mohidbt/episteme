"""RED tests for NotesBackend."""
import os
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret")

USER = "user_test_1"
# `user_id` is now passed via RunnableConfig.configurable (see §1.3b-E2E-3).
CFG = {"configurable": {"user_id": USER}}


def _make_backend(user_id: str = USER):
    from backends.notes_backend import NotesBackend  # noqa: PLC0415
    return NotesBackend(user_id=user_id)


# ---------------------------------------------------------------------------
# read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_read_note_returns_content():
    backend = _make_backend()
    mock_tool = AsyncMock(return_value={"id": "abc", "contentMd": "# Hello world"})
    with patch("backends.notes_backend.read_note") as patched:
        patched.ainvoke = mock_tool
        result = await backend.read("/notes/welcome.md")

    mock_tool.assert_awaited_once_with({"id_or_slug": "welcome"}, config=CFG)
    assert result == "# Hello world"


@pytest.mark.asyncio
async def test_read_note_strips_prefix_and_suffix():
    backend = _make_backend()
    mock_tool = AsyncMock(return_value={"contentMd": "body"})
    with patch("backends.notes_backend.read_note") as patched:
        patched.ainvoke = mock_tool
        await backend.read("/notes/my-note-slug.md")

    mock_tool.assert_awaited_once_with({"id_or_slug": "my-note-slug"}, config=CFG)


# ---------------------------------------------------------------------------
# ls
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ls_notes_returns_md_paths():
    backend = _make_backend()
    notes = [{"slug": "intro"}, {"slug": "theory"}]
    mock_tool = AsyncMock(return_value=notes)
    with patch("backends.notes_backend.list_notes") as patched:
        patched.ainvoke = mock_tool
        result = await backend.ls("/notes/")

    assert result == ["intro.md", "theory.md"]


@pytest.mark.asyncio
async def test_ls_notes_uses_id_when_no_slug():
    backend = _make_backend()
    notes = [{"id": "uuid-1"}]  # no slug field
    mock_tool = AsyncMock(return_value=notes)
    with patch("backends.notes_backend.list_notes") as patched:
        patched.ainvoke = mock_tool
        result = await backend.ls("/notes/")

    assert result == ["uuid-1.md"]


# ---------------------------------------------------------------------------
# write
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_write_calls_update_note_when_read_succeeds():
    """If read_note resolves to an id, write calls update_note."""
    backend = _make_backend()
    mock_read = AsyncMock(return_value={"id": "note-uuid-1", "contentMd": "old"})
    mock_update = AsyncMock(return_value={"updated": True})

    with patch("backends.notes_backend.read_note") as patched_read, \
         patch("backends.notes_backend.update_note") as patched_update:
        patched_read.ainvoke = mock_read
        patched_update.ainvoke = mock_update
        await backend.write("/notes/existing.md", "new content")

    mock_read.assert_awaited_once_with({"id_or_slug": "existing"}, config=CFG)
    mock_update.assert_awaited_once_with(
        {"id": "note-uuid-1", "contentMd": "new content"}, config=CFG
    )


@pytest.mark.asyncio
async def test_write_calls_create_note_when_read_fails():
    """If read_note raises (note not found), write falls back to create_note."""
    backend = _make_backend()
    mock_read = AsyncMock(side_effect=Exception("Not found"))
    mock_create = AsyncMock(return_value={"id": "new-id"})

    with patch("backends.notes_backend.read_note") as patched_read, \
         patch("backends.notes_backend.create_note") as patched_create:
        patched_read.ainvoke = mock_read
        patched_create.ainvoke = mock_create
        await backend.write("/notes/new-note.md", "content here")

    mock_create.assert_awaited_once_with(
        {"title": "new-note", "contentMd": "content here"}, config=CFG
    )


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_raises_not_implemented():
    backend = _make_backend()
    with pytest.raises(NotImplementedError):
        await backend.delete("/notes/x.md")
