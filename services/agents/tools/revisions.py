"""LangChain tools for revision history and activity in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.

``week_summary`` and ``activity`` previously hit endpoints
(``/api/activity``, ``/api/activity/summary``) that do not exist in
apps/km. They are kept as importable stubs returning a structured "tool
unavailable" error and are NOT included in the ``TOOLS`` export.
"""
from urllib.parse import quote_plus

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get
from tools._auth import user_id_from_config


_UNAVAILABLE = {
    "error": True,
    "status": None,
    "body": "tool unavailable in this build",
}


@tool
async def diff_revision(
    note_id: str, rev_a: str, rev_b: str, *, config: RunnableConfig
) -> object:
    """Return the full content of two note revisions side-by-side.

    There is no server-side diff route; the agent's LLM diffs the two
    contents itself. Use this when the user asks what changed between
    two revisions of a note.

    Args:
        note_id: Note UUID.
        rev_a: Older revision id.
        rev_b: Newer revision id.
    """
    user_id = user_id_from_config(config)
    base = f"/api/notes/{quote_plus(note_id)}/revisions"
    rev_a_payload = await km_get(f"{base}/{quote_plus(rev_a)}", user_id=user_id)
    rev_b_payload = await km_get(f"{base}/{quote_plus(rev_b)}", user_id=user_id)
    return {"note_id": note_id, "rev_a": rev_a_payload, "rev_b": rev_b_payload}


@tool
async def week_summary(weeks: int = 1, *, config: RunnableConfig) -> object:
    """[UNAVAILABLE] Activity summary endpoint does not exist in the
    current KM build. Retained as a placeholder; not exposed to the LLM.
    """
    return _UNAVAILABLE


@tool
async def activity(days: int = 1, *, config: RunnableConfig) -> object:
    """[UNAVAILABLE] Activity feed endpoint does not exist in the current
    KM build. Retained as a placeholder; not exposed to the LLM.
    """
    return _UNAVAILABLE


TOOLS = [diff_revision]
