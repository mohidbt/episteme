"""LangChain tools for publishing notes in apps/km.

Approval convention
-------------------
`make_public` carries ``metadata={"require_approval": True}`` so that
``HumanInTheLoopMiddleware`` (and the km_agent factory in Task 4) can identify
it as a destructive action that requires human sign-off before execution.

The middleware looks up the tool name in its ``interrupt_on`` dict.  The
``metadata`` dict on the BaseTool instance is the canonical place to advertise
this requirement to *other* code (e.g. the factory that builds the
``interrupt_on`` mapping dynamically from ``ALL_TOOLS``).
"""
from langchain_core.tools import tool

from lib.km_http import km_post


@tool
async def make_public(
    user_id: str, note_id: str, public_slug: str | None = None
) -> object:
    """Publish a note publicly, making it visible without authentication.

    REQUIRES HUMAN APPROVAL before execution — this is an irreversible
    visibility change. The agent runtime must pause and get explicit user
    confirmation before calling this tool.

    Args:
        user_id: The authenticated user's ID.
        note_id: UUID of the note to publish.
        public_slug: Optional custom URL slug for the public note page.
    """
    body: dict = {"public_slug": public_slug}
    return await km_post(f"/api/notes/{note_id}/publish", body, user_id=user_id)


# Tag make_public so HumanInTheLoopMiddleware and the km_agent factory can
# identify it without hard-coding the name.
make_public.metadata = {"require_approval": True}  # type: ignore[attr-defined]

TOOLS = [make_public]
