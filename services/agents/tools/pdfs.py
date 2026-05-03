"""LangChain tools for PDF/paper operations in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.

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
async def pdf_read_text(
    paper_id: str,
    page: int,
    *,
    config: RunnableConfig,
) -> object:
    """Read text from a single page of a paper PDF.

    For multi-page or full-document text, use ``read_paper`` with
    ``scope={"kind": "pages", "range": [lo, hi]}`` or ``scope={"kind": "full"}``.

    Args:
        paper_id: Paper UUID.
        page: 1-based page number (required).
    """
    user_id = user_id_from_config(config)
    return await km_get(
        f"/api/papers/{quote_plus(paper_id)}/pages/{page}/text",
        user_id=user_id,
    )


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
async def pdf_read_tables(
    paper_id: str, page: int | None = None, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] Use ``read_paper`` with ``scope={"kind": "blocks", "types": ["table"]}`` instead."""
    _ = (paper_id, page, config)
    return _UNAVAILABLE


@tool
async def pdf_extract_data(
    paper_id: str, schema: dict, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] No backend route on main. Use ``read_paper`` then have the LLM extract structured fields."""
    _ = (paper_id, schema, config)
    return _UNAVAILABLE


@tool
async def pdf_explain_passage(
    paper_id: str,
    page: int,
    text: str,
    *,
    config: RunnableConfig,
) -> object:
    """Explain a selected passage from a paper PDF.

    Fetches the surrounding page text so the agent can ground its
    explanation in the passage's context. The agent's main LLM
    synthesises the final explanation from the structured result.

    Args:
        paper_id: Paper UUID.
        page: 1-based page number where the passage appears.
        text: The selected passage text to explain.
    """
    user_id = user_id_from_config(config)
    page_context = await km_get(
        f"/api/papers/{quote_plus(paper_id)}/pages/{page}/text",
        user_id=user_id,
    )
    return {
        "paper_id": paper_id,
        "page": page,
        "passage": text,
        "page_context": page_context,
    }


@tool
async def extract_passages(
    pdf_id: str, query: str, k: int = 5, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] Placeholder retained for compatibility imports."""
    _ = (pdf_id, query, k, config)
    return _UNAVAILABLE


@tool
async def get_page_text(pdf_id: str, page: int, *, config: RunnableConfig) -> object:
    """[UNAVAILABLE] Placeholder retained for compatibility imports."""
    _ = (pdf_id, page, config)
    return _UNAVAILABLE


# Tools advertised to the LLM. Stubbed tools (pdf_read_tables, pdf_extract_data,
# extract_passages, get_page_text) are deliberately excluded.
TOOLS = [
    list_pdfs,
    search_pdfs,
    pdf_read_text,
    highlight,
    pdf_explain_passage,
]
