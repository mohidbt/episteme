"""LangChain tools for notes CRUD + graph operations in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.
"""
from urllib.parse import quote, quote_plus

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get, km_patch, km_post
from tools._auth import user_id_from_config


@tool
async def list_notes(*, config: RunnableConfig) -> object:
    """List ALL of the calling user's notes (titles, ids, slugs).

    USE THIS when the user asks to enumerate, list, show all, or count
    their notes — do NOT use search_notes for that. Returns the full set;
    no query required.
    """
    user_id = user_id_from_config(config)
    return await km_get("/api/notes", user_id=user_id)


@tool
async def search_notes(query: str, k: int = 10, *, config: RunnableConfig) -> object:
    """Semantic search over the calling user's notes.

    Use ONLY when the user describes content semantically (e.g. "find
    notes about transformers"). For listing all notes or counting them,
    use list_notes instead.

    Args:
        query: Natural-language search query.
        k: Maximum number of results to return (default 10).
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/notes/search?q={quote_plus(query)}&k={k}", user_id=user_id)


@tool
async def read_note(id_or_slug: str, *, config: RunnableConfig) -> object:
    """Fetch a single note by UUID or slug.

    Args:
        id_or_slug: Note UUID or URL slug.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/notes/{quote(id_or_slug, safe='')}", user_id=user_id)


@tool
async def create_note(
    title: str,
    contentMd: str,
    library_id: int | None = None,
    folder_path: str | None = None,
    *,
    config: RunnableConfig,
) -> object:
    """Create a new note in the user's KM.

    Use this whenever the user asks you to write/save a draft, summary,
    or new note. Do NOT ask the user for library_id — call list_libraries
    only if you genuinely need to disambiguate. Most asks should not
    require any disambiguation; the user's default library is used when
    library_id is omitted.

    Args:
        title: Required. Note title.
        contentMd: Required. Note body in Markdown.
        library_id: Optional. Numeric library ID (from list_libraries).
            If omitted, the user's default library is used.
        folder_path: Optional. Slash-delimited folder path inside the
            library (e.g. "research/2026"). If omitted, the note lands
            at the library root.
    """
    user_id = user_id_from_config(config)
    body: dict = {"title": title, "contentMd": contentMd}
    if library_id is not None:
        body["libraryId"] = library_id
    if folder_path is not None:
        body["folderPath"] = folder_path
    return await km_post("/api/notes", body, user_id=user_id)


@tool
async def list_folders(
    library_id: int | None = None, *, config: RunnableConfig
) -> object:
    """List folders inside a library so the agent can decide where to file a note.

    Returns ``{libraryId, folders: [{id, name, parentId, isTrash, sortOrder}]}``.
    Folders are hierarchical via ``parentId`` (null = root).

    Args:
        library_id: Optional. Numeric library ID. If omitted, the user's
            default library is used.
    """
    user_id = user_id_from_config(config)
    path = "/api/folders"
    if library_id is not None:
        path += f"?libraryId={library_id}"
    return await km_get(path, user_id=user_id)


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
    list_folders,
    update_note,
    list_links,
    list_backlinks,
]
