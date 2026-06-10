"""GSD-85: create_folder tool — wraps POST /api/folders.

Sibling to move_folder/rename_folder/delete_folder in drive_ops. Carries
require_approval so HumanInTheLoopMiddleware gates folder creation.
"""
from __future__ import annotations

import os

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


def test_create_folder_in_ALL_TOOLS():
    from tools import ALL_TOOLS

    assert "create_folder" in {t.name for t in ALL_TOOLS}


def test_create_folder_requires_approval():
    from tools import drive_ops

    md = getattr(drive_ops.create_folder, "metadata", None) or {}
    assert md.get("require_approval") is True


def test_create_folder_in_core_tool_names():
    from km_agent import _CORE_TOOL_NAMES

    assert "create_folder" in _CORE_TOOL_NAMES


def test_create_folder_default_approval_is_require():
    from km_agent import _DEFAULT_APPROVAL_RULES

    assert _DEFAULT_APPROVAL_RULES.get("create_folder") == "require"


@pytest.mark.asyncio
async def test_create_folder_posts_to_api_folders():
    from tools.drive_ops import create_folder

    with patch("tools.drive_ops.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "new-folder-uuid", "name": "Archive"}
        out = await create_folder.ainvoke(
            {"name": "Archive", "library_id": 42, "parent_folder_id": None},
            config=CFG,
        )

    call = mock_post.await_args
    assert call.args[0] == "/api/folders"
    assert call.args[1] == {"libraryId": 42, "parentId": None, "name": "Archive"}
    assert call.kwargs["user_id"] == USER
    assert out["id"] == "new-folder-uuid"


@pytest.mark.asyncio
async def test_create_folder_passes_parent_folder_id():
    from tools.drive_ops import create_folder

    with patch("tools.drive_ops.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "child-uuid"}
        await create_folder.ainvoke(
            {
                "name": "Subfolder",
                "library_id": 7,
                "parent_folder_id": "parent-uuid",
            },
            config=CFG,
        )

    call = mock_post.await_args
    assert call.args[1] == {
        "libraryId": 7,
        "parentId": "parent-uuid",
        "name": "Subfolder",
    }


@pytest.mark.asyncio
async def test_create_folder_defaults_parent_to_null():
    """When parent_folder_id is omitted, parentId defaults to None (root)."""
    from tools.drive_ops import create_folder

    with patch("tools.drive_ops.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"id": "root-folder"}
        await create_folder.ainvoke(
            {"name": "Inbox", "library_id": 1}, config=CFG
        )

    assert mock_post.await_args.args[1]["parentId"] is None
