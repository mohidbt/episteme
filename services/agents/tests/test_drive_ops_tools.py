"""GSD-57: drive_ops — move/rename/delete tools for papers and folders.

All destructive ops (delete_*) carry require_approval; move_* also gated.

KM routes wrapped:
* PATCH /api/papers/{id}                — title (rename) + folderId (move)
* POST  /api/folders/move               — move folder under new parent
* PATCH /api/folders/{id}               — rename folder
* POST  /api/folders/trash              — trash paper or folder
"""
from __future__ import annotations

import os

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


@pytest.mark.parametrize(
    "name",
    [
        "move_paper",
        "rename_paper",
        "delete_paper",
        "move_folder",
        "rename_folder",
        "delete_folder",
    ],
)
def test_drive_ops_tool_in_TOOLS(name):
    from tools import ALL_TOOLS

    assert name in {t.name for t in ALL_TOOLS}


@pytest.mark.parametrize(
    "name",
    [
        "move_paper",
        "delete_paper",
        "move_folder",
        "delete_folder",
    ],
)
def test_destructive_ops_require_approval(name):
    from tools import drive_ops

    fn = getattr(drive_ops, name)
    md = getattr(fn, "metadata", None) or {}
    assert md.get("require_approval") is True, name


@pytest.mark.asyncio
async def test_move_paper_patches_folder_id():
    from tools.drive_ops import move_paper

    with patch("tools.drive_ops.km_patch", new_callable=AsyncMock) as mock_patch:
        mock_patch.return_value = {"id": "p1", "folderId": "f9"}
        out = await move_paper.ainvoke(
            {"paper_id": "p1", "target_folder_id": "f9"}, config=CFG
        )

    assert out == {"id": "p1", "folderId": "f9"}
    call = mock_patch.await_args
    assert call.args[0] == "/api/papers/p1"
    assert call.args[1] == {"folderId": "f9"}
    assert call.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_rename_paper_patches_title():
    from tools.drive_ops import rename_paper

    with patch("tools.drive_ops.km_patch", new_callable=AsyncMock) as mock_patch:
        mock_patch.return_value = {"id": "p1", "title": "New Title"}
        out = await rename_paper.ainvoke(
            {"paper_id": "p1", "new_title": "New Title"}, config=CFG
        )

    call = mock_patch.await_args
    assert call.args[0] == "/api/papers/p1"
    assert call.args[1] == {"title": "New Title"}
    assert out["title"] == "New Title"


@pytest.mark.asyncio
async def test_delete_paper_posts_to_trash():
    from tools.drive_ops import delete_paper

    with patch("tools.drive_ops.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"ok": True, "status": 204}
        out = await delete_paper.ainvoke(
            {"paper_id": "p1", "library_id": 587}, config=CFG
        )

    call = mock_post.await_args
    assert call.args[0] == "/api/folders/trash"
    assert call.args[1] == {
        "libraryId": 587,
        "target": {"kind": "paper", "id": "p1"},
    }
    assert out["ok"] is True


@pytest.mark.asyncio
async def test_move_folder_posts_to_folders_move():
    from tools.drive_ops import move_folder

    with patch("tools.drive_ops.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"ok": True, "status": 204}
        await move_folder.ainvoke(
            {
                "folder_id": "fA",
                "target_parent_id": "fB",
            },
            config=CFG,
        )

    call = mock_post.await_args
    assert call.args[0] == "/api/folders/move"
    assert call.args[1] == {"folderId": "fA", "targetParentId": "fB"}


@pytest.mark.asyncio
async def test_move_folder_accepts_null_parent_for_root():
    from tools.drive_ops import move_folder

    with patch("tools.drive_ops.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"ok": True}
        await move_folder.ainvoke(
            {"folder_id": "fA", "target_parent_id": None}, config=CFG
        )

    assert mock_post.await_args.args[1]["targetParentId"] is None


@pytest.mark.asyncio
async def test_rename_folder_patches_name():
    from tools.drive_ops import rename_folder

    with patch("tools.drive_ops.km_patch", new_callable=AsyncMock) as mock_patch:
        mock_patch.return_value = {"ok": True}
        await rename_folder.ainvoke(
            {"folder_id": "fA", "new_name": "Renamed"}, config=CFG
        )

    call = mock_patch.await_args
    assert call.args[0] == "/api/folders/fA"
    assert call.args[1] == {"name": "Renamed"}


@pytest.mark.asyncio
async def test_delete_folder_posts_to_trash_with_kind_folder():
    from tools.drive_ops import delete_folder

    with patch("tools.drive_ops.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"ok": True}
        await delete_folder.ainvoke(
            {"folder_id": "fA", "library_id": 17}, config=CFG
        )

    call = mock_post.await_args
    assert call.args[0] == "/api/folders/trash"
    assert call.args[1] == {
        "libraryId": 17,
        "target": {"kind": "folder", "id": "fA"},
    }
