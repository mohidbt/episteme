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
from tools._drive_filter import filter_hidden


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
    """List BIBLIOGRAPHIC references (Zotero-style citations from `.bib` import
    or manual entry) in a given library — NOT the user's stored PDF files.

    If the user asks to find a paper they have, use `search_pdfs` (search by
    title substring) or `list_pdfs` (enumerate all PDFs in a library).
    References are a separate table (`library_references`) used for citation
    management; PDFs live in `papers`. The two are linked via
    `library_references.paperId` once a matching PDF has been located.

    Use this to enumerate all references (papers cited / catalogued) inside
    one of the user's libraries.

    Behavior:
    - If `libraryId` is omitted, returns the UNION of references across
      EVERY library the user owns. Avoids silently picking one when the
      user has multiple libraries.
    - If `libraryId` is provided, scopes to that one library.

    NEVER guess or invent a libraryId — they are opaque integers (e.g.
    587, 17018), not sequential.

    Returns at most 20 per library by default. Server caps at 100 per call.

    Args:
        libraryId: Optional numeric library ID (from list_libraries). Omit
            to span every library the user has.
        q: Optional substring filter applied to citationKey and title.
        limit: Max rows to return PER LIBRARY (default 20, server caps at 100).
        offset: Rows to skip for pagination (default 0).
    """
    user_id = user_id_from_config(config)

    def _qs(lib_id: int) -> str:
        path = f"/api/references?libraryId={lib_id}"
        if q:
            path += f"&q={quote_plus(q)}"
        path += f"&limit={limit}&offset={offset}"
        return path

    if libraryId is not None:
        return filter_hidden(await km_get(_qs(libraryId), user_id=user_id))

    libs = await km_get("/api/libraries", user_id=user_id)
    if not isinstance(libs, list) or not libs:
        return {"error": True, "message": "No libraries found for user"}
    out: list = []
    for lib in libs:
        rows = await km_get(_qs(lib["id"]), user_id=user_id)
        if isinstance(rows, list):
            out.extend(rows)
    return filter_hidden(out)


@tool
async def get_reference(id: str, *, config: RunnableConfig) -> object:
    """Fetch a single reference by ID.

    Args:
        id: Reference UUID.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/references/{id}", user_id=user_id)


TOOLS = [list_libraries, list_references, get_reference]
