"""LangChain tools for the reference library in apps/reader.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.
"""
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import reader_get
from tools._auth import user_id_from_config


@tool
async def list_references(q: str | None = None, *, config: RunnableConfig) -> object:
    """List references in the calling user's library, optionally filtered by a query.

    Args:
        q: Optional search query to filter references by title/author/abstract.
    """
    user_id = user_id_from_config(config)
    path = "/api/library" if q is None else f"/api/library?q={q}"
    return await reader_get(path, user_id=user_id)


@tool
async def get_reference(id: str, *, config: RunnableConfig) -> object:
    """Fetch a single reference by ID.

    Args:
        id: Reference UUID.
    """
    user_id = user_id_from_config(config)
    return await reader_get(f"/api/library/{id}", user_id=user_id)


TOOLS = [list_references, get_reference]
