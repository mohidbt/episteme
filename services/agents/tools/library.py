"""LangChain tools for the reference library in apps/reader."""
from langchain_core.tools import tool

from lib.km_http import reader_get


@tool
async def list_references(user_id: str, q: str | None = None) -> object:
    """List references in the user's library, optionally filtered by a query.

    Args:
        user_id: The authenticated user's ID.
        q: Optional search query to filter references by title/author/abstract.
    """
    path = "/api/library" if q is None else f"/api/library?q={q}"
    return await reader_get(path, user_id=user_id)


@tool
async def get_reference(user_id: str, id: str) -> object:
    """Fetch a single reference by ID.

    Args:
        user_id: The authenticated user's ID.
        id: Reference UUID.
    """
    return await reader_get(f"/api/library/{id}", user_id=user_id)


TOOLS = [list_references, get_reference]
