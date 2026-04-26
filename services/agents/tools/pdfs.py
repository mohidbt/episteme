"""LangChain tools for PDF operations in apps/reader."""
from langchain_core.tools import tool

from lib.km_http import reader_get, reader_post


@tool
async def list_pdfs(user_id: str) -> object:
    """List all PDFs in the user's library.

    Args:
        user_id: The authenticated user's ID.
    """
    return await reader_get("/api/pdfs", user_id=user_id)


@tool
async def extract_passages(user_id: str, pdf_id: str, query: str, k: int = 5) -> object:
    """Extract relevant passages from a PDF using semantic search.

    Args:
        user_id: The authenticated user's ID.
        pdf_id: PDF document UUID.
        query: Natural-language query to match passages against.
        k: Maximum number of passages to return (default 5).
    """
    return await reader_get(f"/api/pdfs/{pdf_id}/passages?q={query}&k={k}", user_id=user_id)


@tool
async def highlight(
    user_id: str, pdf_id: str, page: int, range_: str, note: str | None = None
) -> object:
    """Create a highlight annotation on a PDF page.

    Args:
        user_id: The authenticated user's ID.
        pdf_id: PDF document UUID.
        page: 1-based page number.
        range_: Text range string (e.g. "0-50" as character offsets).
        note: Optional annotation note attached to the highlight.
    """
    body: dict = {"page": page, "range": range_}
    if note is not None:
        body["note"] = note
    return await reader_post(f"/api/pdfs/{pdf_id}/highlights", body, user_id=user_id)


@tool
async def get_page_text(user_id: str, pdf_id: str, page: int) -> object:
    """Get the extracted text content for a single PDF page.

    Args:
        user_id: The authenticated user's ID.
        pdf_id: PDF document UUID.
        page: 1-based page number.
    """
    return await reader_get(f"/api/pdfs/{pdf_id}/pages/{page}/text", user_id=user_id)


TOOLS = [list_pdfs, extract_passages, highlight, get_page_text]
