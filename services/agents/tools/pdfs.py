"""LangChain tools for PDF/paper operations in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.

Stubbed tools
-------------
``extract_passages`` and ``get_page_text`` retain their function definitions
so existing backends (``backends/pdfs_backend.py``) and skills can still
import them, but they return a structured "tool unavailable" error and are
no longer included in the ``TOOLS`` export. The reader app (which provided
per-PDF semantic search and page-text extraction) is dead; KM does not yet
expose equivalents. These will be revived when the "PDF reader revive"
work lands.
"""
from urllib.parse import quote_plus

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get, km_post
from tools._auth import user_id_from_config


_UNAVAILABLE = {
    "error": True,
    "status": None,
    "body": "tool unavailable in this build",
}


@tool
async def list_pdfs(libraryId: int, *, config: RunnableConfig) -> object:
    """List ALL PDFs/papers inside a specific library.

    USE THIS when the user asks to enumerate, list, show all, or count
    PDFs/papers in a library — do NOT use search_pdfs for that. Call
    ``list_libraries`` first to obtain a libraryId.

    Args:
        libraryId: Numeric library ID (from list_libraries).
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/papers?libraryId={libraryId}", user_id=user_id)


@tool
async def search_pdfs(query: str, *, config: RunnableConfig) -> object:
    """Search across ALL of the user's PDFs/papers by title or filename.

    Use ONLY when the user asks to find a specific paper by a query term
    (e.g. "find the attention paper"). For listing every PDF in a library,
    use list_pdfs instead.
    Returns up to 20 matches (id, title, filename, year, doi).

    Args:
        query: Substring to match against title/filename.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/pdfs/search?q={quote_plus(query)}", user_id=user_id)


@tool
async def extract_passages(
    pdf_id: str, query: str, k: int = 5, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] Per-PDF semantic passage search is not implemented in
    the current KM build. This tool is retained as a placeholder and is
    NOT exposed to the LLM.
    """
    return _UNAVAILABLE


@tool
async def highlight(
    pdf_id: str,
    page: int,
    note: str | None = None,
    color: str | None = None,
    *,
    config: RunnableConfig,
) -> object:
    """Create a highlight annotation on a PDF page.

    Args:
        pdf_id: Paper UUID.
        page: 1-based page number.
        note: Optional Markdown note attached to the highlight.
        color: Optional color string (e.g. "yellow").
    """
    user_id = user_id_from_config(config)
    body: dict = {"paperId": pdf_id, "page": page}
    if note is not None:
        body["noteMd"] = note
    if color is not None:
        body["color"] = color
    return await km_post("/api/paper-highlights", body, user_id=user_id)


@tool
async def get_page_text(pdf_id: str, page: int, *, config: RunnableConfig) -> object:
    """[UNAVAILABLE] Per-page text extraction is not implemented in the
    current KM build. This tool is retained as a placeholder and is NOT
    exposed to the LLM.
    """
    return _UNAVAILABLE


# Tools advertised to the LLM. Stubbed tools (extract_passages, get_page_text)
# are deliberately excluded.
TOOLS = [list_pdfs, search_pdfs, highlight]
