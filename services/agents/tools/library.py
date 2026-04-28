"""LangChain tools for the reference library in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.

Note: prior versions of this module pointed at the (now-defunct) reader
app; KM is the source of truth for libraries, references, papers, and
PDFs. KM's `/api/references` requires a `libraryId`, so the agent uses
``list_libraries`` first to discover available library IDs.
"""
from urllib.parse import quote_plus

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get
from tools._auth import user_id_from_config


@tool
async def list_libraries(*, config: RunnableConfig) -> object:
    """List the calling user's libraries (id, name).

    Use this FIRST before list_references / list_pdfs — those endpoints
    require a libraryId.
    """
    user_id = user_id_from_config(config)
    return await km_get("/api/libraries", user_id=user_id)


@tool
async def list_references(
    libraryId: int | None = None,
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
    *,
    config: RunnableConfig,
) -> object:
    """List bibliographic references in a given library, optionally filtered.

    Use this to enumerate all references (papers cited / catalogued) inside
    one of the user's libraries.

    IMPORTANT: If you don't know the user's libraryId, either omit it (uses
    default library) or call list_libraries first. NEVER guess or invent a
    libraryId — they are opaque integers (e.g. 587, 17018), not sequential.

    Returns at most 20 by default. Server caps at 100 regardless.

    Args:
        libraryId: Numeric library ID (from list_libraries). If omitted, lists
            references from the user's first (default) library.
        q: Optional substring filter applied to citationKey and title.
        limit: Max rows to return (default 20, server caps at 100).
        offset: Rows to skip for pagination (default 0).
    """
    user_id = user_id_from_config(config)
    if libraryId is None:
        libs = await km_get("/api/libraries", user_id=user_id)
        if isinstance(libs, list) and libs:
            libraryId = libs[0]["id"]
        else:
            return {"error": True, "message": "No libraries found for user"}
    path = f"/api/references?libraryId={libraryId}"
    if q:
        path += f"&q={quote_plus(q)}"
    path += f"&limit={limit}&offset={offset}"
    return await km_get(path, user_id=user_id)


@tool
async def get_reference(id: str, *, config: RunnableConfig) -> object:
    """Fetch a single reference by ID.

    Args:
        id: Reference UUID.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/references/{id}", user_id=user_id)


TOOLS = [list_libraries, list_references, get_reference]
