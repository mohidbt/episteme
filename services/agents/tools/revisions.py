"""LangChain tools for revision history and activity in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.

Stubbed tools
-------------
``diff_revision``, ``week_summary`` and ``activity`` previously hit
endpoints (``/api/notes/<id>/revisions/diff``, ``/api/activity``,
``/api/activity/summary``) that do not exist in apps/km. They are kept as
importable stubs returning a structured "tool unavailable" error and are
NOT included in the ``TOOLS`` export so the LLM never sees them.
"""
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool


_UNAVAILABLE = {
    "error": True,
    "status": None,
    "body": "tool unavailable in this build",
}


@tool
async def diff_revision(
    note_id: str, rev_a: str, rev_b: str, *, config: RunnableConfig
) -> object:
    """[UNAVAILABLE] Cross-revision diffing is not implemented in the
    current KM build. Retained as a placeholder; not exposed to the LLM.
    """
    return _UNAVAILABLE


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


# All tools in this module are stubs at the moment — none are advertised
# to the LLM. The list is empty (rather than removed) so callers that do
# ``from tools.revisions import TOOLS`` keep working.
TOOLS: list = []
