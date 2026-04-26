"""LangChain tools for notes CRUD + graph operations in apps/km."""
from langchain_core.tools import tool

from lib.km_http import km_get, km_patch, km_post


@tool
async def list_notes(user_id: str, scope: str | None = None) -> object:
    """List all notes for the user.

    Args:
        user_id: The authenticated user's ID.
        scope: Optional filter scope (reserved for future use; ignored for now
               because /api/notes does not yet support a scope query param).
    """
    # TODO(1.3b): forward scope once apps/km /api/notes supports it
    return await km_get("/api/notes", user_id=user_id)


@tool
async def search_notes(user_id: str, query: str, k: int = 10) -> object:
    """Semantic search over the user's notes.

    Args:
        user_id: The authenticated user's ID.
        query: Natural-language search query.
        k: Maximum number of results to return (default 10).
    """
    return await km_get(f"/api/notes/search?q={query}&k={k}", user_id=user_id)


@tool
async def read_note(user_id: str, id_or_slug: str) -> object:
    """Fetch a single note by UUID or slug.

    Args:
        user_id: The authenticated user's ID.
        id_or_slug: Note UUID or URL slug.
    """
    return await km_get(f"/api/notes/{id_or_slug}", user_id=user_id)


@tool
async def create_note(
    user_id: str, title: str, contentMd: str, notebookId: str | None = None
) -> object:
    """Create a new note in the user's knowledge base.

    Args:
        user_id: The authenticated user's ID.
        title: Note title.
        contentMd: Note body in Markdown.
        notebookId: Optional notebook UUID to place the note in.
    """
    body: dict = {"title": title, "contentMd": contentMd}
    if notebookId is not None:
        body["notebookId"] = notebookId
    return await km_post("/api/notes", body, user_id=user_id)


@tool
async def update_note(user_id: str, id: str, contentMd: str) -> object:
    """Update an existing note's content.

    Args:
        user_id: The authenticated user's ID.
        id: Note UUID.
        contentMd: New note body in Markdown.
    """
    return await km_patch(f"/api/notes/{id}", {"contentMd": contentMd}, user_id=user_id)


@tool
async def list_links(user_id: str, note_id: str) -> object:
    """List outbound wiki-links from a note.

    Args:
        user_id: The authenticated user's ID.
        note_id: Source note UUID.
    """
    return await km_get(f"/api/notes/{note_id}/links", user_id=user_id)


@tool
async def list_backlinks(user_id: str, note_id: str) -> object:
    """List notes that link to the given note (backlinks).

    Args:
        user_id: The authenticated user's ID.
        note_id: Target note UUID.
    """
    return await km_get(f"/api/notes/{note_id}/backlinks", user_id=user_id)


TOOLS = [
    list_notes,
    search_notes,
    read_note,
    create_note,
    update_note,
    list_links,
    list_backlinks,
]
