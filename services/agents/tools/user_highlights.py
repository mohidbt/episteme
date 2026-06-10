"""LangChain tools for user highlight round-trip in apps/km.

Closes the loop on the existing `highlight` tool (which only creates):
* `list_user_highlights(paper_id)` — enumerate highlights on a paper
* `delete_user_highlight(highlight_id)` — destructive; HITL-gated

The KM `GET /api/user-highlights` route requires `paperId`, so this tool
does too. Listing across all of a user's papers would be O(libraries ×
papers) requests — defer until KM exposes a global list endpoint.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py``.
"""
from urllib.parse import quote_plus

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_delete, km_get
from tools._auth import user_id_from_config


@tool
async def list_user_highlights(
    paper_id: str | None = None, *, config: RunnableConfig
) -> object:
    """List the user's highlights on a paper.

    Args:
        paper_id: REQUIRED paper UUID. The backing KM route is
            paper-scoped; calling without a paper_id returns a clear
            error rather than silently fanning out across the library.
    """
    if not paper_id:
        return {
            "error": True,
            "status": 400,
            "message": "paper_id is required (the KM route is paper-scoped)",
        }
    user_id = user_id_from_config(config)
    return await km_get(
        f"/api/user-highlights?paperId={quote_plus(paper_id)}", user_id=user_id
    )


@tool
async def delete_user_highlight(
    highlight_id: str, *, config: RunnableConfig
) -> object:
    """Delete a single user highlight by id.

    REQUIRES HUMAN APPROVAL — irreversible. Pair with
    ``list_user_highlights`` to discover ids before calling.

    Args:
        highlight_id: Numeric highlight id (as a string) from
            ``list_user_highlights``.
    """
    user_id = user_id_from_config(config)
    return await km_delete(
        f"/api/user-highlights/{quote_plus(highlight_id)}", user_id=user_id
    )


delete_user_highlight.metadata = {"require_approval": True}  # type: ignore[attr-defined]

TOOLS = [list_user_highlights, delete_user_highlight]
