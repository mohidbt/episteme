"""LangChain tools: drive CRUD over papers and folders in apps/km.

Move / rename / delete for both papers and folders. Closes the
read-heavy / write-light gap on drive structure so the agent can
reorganize the user's library on request.

KM routes wrapped:
* PATCH /api/papers/{id}         — title (rename) + folderId (move)
* POST  /api/folders/move        — move folder under new parent
* PATCH /api/folders/{id}        — rename folder
* POST  /api/folders/trash       — soft-delete paper or folder

All destructive ops (delete_*) carry ``require_approval`` metadata so
the agent's HumanInTheLoopMiddleware gates them. ``move_*`` is also
gated — the user wants to confirm reorgs before they happen.

The authenticated user_id is injected at runtime via ``RunnableConfig``.
"""
from urllib.parse import quote

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_patch, km_post
from tools._auth import user_id_from_config


# ---------------------------------------------------------------------------
# Paper ops
# ---------------------------------------------------------------------------


@tool
async def move_paper(
    paper_id: str, target_folder_id: str, *, config: RunnableConfig
) -> object:
    """Move a paper into a folder.

    REQUIRES HUMAN APPROVAL — reorganizes user library.

    Args:
        paper_id: Paper UUID.
        target_folder_id: Destination folder UUID. Use ``list_folders``
            to discover.
    """
    user_id = user_id_from_config(config)
    return await km_patch(
        f"/api/papers/{quote(paper_id, safe='')}",
        {"folderId": target_folder_id},
        user_id=user_id,
    )


move_paper.metadata = {"require_approval": True}  # type: ignore[attr-defined]


@tool
async def rename_paper(
    paper_id: str, new_title: str, *, config: RunnableConfig
) -> object:
    """Rename a paper's title.

    Args:
        paper_id: Paper UUID.
        new_title: New title string.
    """
    user_id = user_id_from_config(config)
    return await km_patch(
        f"/api/papers/{quote(paper_id, safe='')}",
        {"title": new_title},
        user_id=user_id,
    )


@tool
async def delete_paper(
    paper_id: str, library_id: int, *, config: RunnableConfig
) -> object:
    """Move a paper to the library's trash folder (soft delete).

    REQUIRES HUMAN APPROVAL — paper disappears from the active library
    until restored. Permanent delete is a separate operation requiring
    the paper already be in trash.

    Args:
        paper_id: Paper UUID.
        library_id: Library id the paper lives in (from ``list_libraries``
            or ``find_papers``).
    """
    user_id = user_id_from_config(config)
    return await km_post(
        "/api/folders/trash",
        {"libraryId": library_id, "target": {"kind": "paper", "id": paper_id}},
        user_id=user_id,
    )


delete_paper.metadata = {"require_approval": True}  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Folder ops
# ---------------------------------------------------------------------------


@tool
async def move_folder(
    folder_id: str,
    target_parent_id: str | None,
    *,
    config: RunnableConfig,
) -> object:
    """Move a folder under a new parent folder (or to library root).

    REQUIRES HUMAN APPROVAL — reorganizes user library.

    Args:
        folder_id: Folder UUID to move.
        target_parent_id: Destination parent folder UUID, or ``None`` to
            move the folder to library root.
    """
    user_id = user_id_from_config(config)
    return await km_post(
        "/api/folders/move",
        {"folderId": folder_id, "targetParentId": target_parent_id},
        user_id=user_id,
    )


move_folder.metadata = {"require_approval": True}  # type: ignore[attr-defined]


@tool
async def rename_folder(
    folder_id: str, new_name: str, *, config: RunnableConfig
) -> object:
    """Rename a folder.

    Args:
        folder_id: Folder UUID.
        new_name: New folder name (1-200 chars).
    """
    user_id = user_id_from_config(config)
    return await km_patch(
        f"/api/folders/{quote(folder_id, safe='')}",
        {"name": new_name},
        user_id=user_id,
    )


@tool
async def delete_folder(
    folder_id: str, library_id: int, *, config: RunnableConfig
) -> object:
    """Move a folder (and its children) to the library's trash.

    REQUIRES HUMAN APPROVAL — recursive soft-delete. Children move to
    trash alongside the folder; restore is a separate op.

    Args:
        folder_id: Folder UUID.
        library_id: Library id the folder lives in.
    """
    user_id = user_id_from_config(config)
    return await km_post(
        "/api/folders/trash",
        {"libraryId": library_id, "target": {"kind": "folder", "id": folder_id}},
        user_id=user_id,
    )


delete_folder.metadata = {"require_approval": True}  # type: ignore[attr-defined]


TOOLS = [
    move_paper,
    rename_paper,
    delete_paper,
    move_folder,
    rename_folder,
    delete_folder,
]
