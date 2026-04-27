"""LangChain tools for PDF operations in apps/reader.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.
"""
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import reader_get, reader_post
from tools._auth import user_id_from_config


@tool
async def list_pdfs(*, config: RunnableConfig) -> object:
    """List all PDFs in the calling user's library."""
    user_id = user_id_from_config(config)
    return await reader_get("/api/pdfs", user_id=user_id)


@tool
async def extract_passages(
    pdf_id: str, query: str, k: int = 5, *, config: RunnableConfig
) -> object:
    """Extract relevant passages from a PDF using semantic search.

    Args:
        pdf_id: PDF document UUID.
        query: Natural-language query to match passages against.
        k: Maximum number of passages to return (default 5).
    """
    user_id = user_id_from_config(config)
    return await reader_get(f"/api/pdfs/{pdf_id}/passages?q={query}&k={k}", user_id=user_id)


@tool
async def highlight(
    pdf_id: str,
    page: int,
    range_: str,
    note: str | None = None,
    *,
    config: RunnableConfig,
) -> object:
    """Create a highlight annotation on a PDF page.

    Args:
        pdf_id: PDF document UUID.
        page: 1-based page number.
        range_: Text range string (e.g. "0-50" as character offsets).
        note: Optional annotation note attached to the highlight.
    """
    user_id = user_id_from_config(config)
    body: dict = {"page": page, "range": range_}
    if note is not None:
        body["note"] = note
    return await reader_post(f"/api/pdfs/{pdf_id}/highlights", body, user_id=user_id)


@tool
async def get_page_text(pdf_id: str, page: int, *, config: RunnableConfig) -> object:
    """Get the extracted text content for a single PDF page.

    Args:
        pdf_id: PDF document UUID.
        page: 1-based page number.
    """
    user_id = user_id_from_config(config)
    return await reader_get(f"/api/pdfs/{pdf_id}/pages/{page}/text", user_id=user_id)


TOOLS = [list_pdfs, extract_passages, highlight, get_page_text]
