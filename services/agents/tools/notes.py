"""LangChain tools for notes CRUD + graph operations in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.
"""
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get, km_patch, km_post
from tools._auth import user_id_from_config


@tool
async def list_notes(scope: str | None = None, *, config: RunnableConfig) -> object:
    """List all notes for the calling user.

    Args:
        scope: Optional filter scope (reserved for future use; ignored for now
               because /api/notes does not yet support a scope query param).
    """
    # TODO(1.3b): forward scope once apps/km /api/notes supports it
    user_id = user_id_from_config(config)
    return await km_get("/api/notes", user_id=user_id)


@tool
async def search_notes(query: str, k: int = 10, *, config: RunnableConfig) -> object:
    """Semantic search over the calling user's notes.

    Args:
        query: Natural-language search query.
        k: Maximum number of results to return (default 10).
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/notes/search?q={query}&k={k}", user_id=user_id)


@tool
async def read_note(id_or_slug: str, *, config: RunnableConfig) -> object:
    """Fetch a single note by UUID or slug.

    Args:
        id_or_slug: Note UUID or URL slug.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/notes/{id_or_slug}", user_id=user_id)


@tool
async def create_note(
    title: str,
    contentMd: str,
    notebookId: str | None = None,
    *,
    config: RunnableConfig,
) -> object:
    """Create a new note in the calling user's knowledge base.

    Args:
        title: Note title.
        contentMd: Note body in Markdown.
        notebookId: Optional notebook UUID to place the note in.
    """
    user_id = user_id_from_config(config)
    body: dict = {"title": title, "contentMd": contentMd}
    if notebookId is not None:
        body["notebookId"] = notebookId
    return await km_post("/api/notes", body, user_id=user_id)


@tool
async def update_note(id: str, contentMd: str, *, config: RunnableConfig) -> object:
    """Update an existing note's content.

    Args:
        id: Note UUID.
        contentMd: New note body in Markdown.
    """
    user_id = user_id_from_config(config)
    return await km_patch(f"/api/notes/{id}", {"contentMd": contentMd}, user_id=user_id)


@tool
async def list_links(note_id: str, *, config: RunnableConfig) -> object:
    """List outbound wiki-links from a note.

    Args:
        note_id: Source note UUID.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/notes/{note_id}/links", user_id=user_id)


@tool
async def list_backlinks(note_id: str, *, config: RunnableConfig) -> object:
    """List notes that link to the given note (backlinks).

    Args:
        note_id: Target note UUID.
    """
    user_id = user_id_from_config(config)
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
