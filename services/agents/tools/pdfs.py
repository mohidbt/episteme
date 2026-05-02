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
from tools._drive_filter import filter_hidden


_UNAVAILABLE = {
    "error": True,
    "status": None,
    "body": "tool unavailable in this build",
}


@tool
async def list_pdfs(libraryId: int | None = None, *, config: RunnableConfig) -> object:
    """List individual PDF files / papers in the user's library.

    USE THIS when the user asks to enumerate, list, show all, or count
    PDFs/papers — do NOT use search_pdfs for that.

    DO NOT USE THIS for papersets, spreadsheets, CSVs, extraction tables, or
    any tabular/structured data — those are a different concept. Use
    `browse_papersets` for paperset/spreadsheet/CSV/table listings.

    Behavior:
    - If `libraryId` is omitted, returns the UNION of papers across EVERY
      library the user owns. This is the right default for "which papers
      do I have?" — users often have more than one library and the model
      should not silently pick one.
    - If `libraryId` is provided, scopes to that one library.

    NEVER guess or invent a libraryId — they are opaque integers (e.g.
    587, 17018), not sequential.

    Args:
        libraryId: Optional numeric library ID (from list_libraries) to
            restrict the query. Omit to see every paper the user has.
    """
    user_id = user_id_from_config(config)
    if libraryId is not None:
        return filter_hidden(
            await km_get(f"/api/papers?libraryId={libraryId}", user_id=user_id)
        )
    libs = await km_get("/api/libraries", user_id=user_id)
    if not isinstance(libs, list) or not libs:
        return {"error": True, "message": "No libraries found for user"}
    out: list = []
    for lib in libs:
        rows = await km_get(f"/api/papers?libraryId={lib['id']}", user_id=user_id)
        if isinstance(rows, list):
            out.extend(rows)
    return filter_hidden(out)


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
