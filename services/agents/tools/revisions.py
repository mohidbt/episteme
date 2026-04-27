"""LangChain tools for revision history and activity in apps/km.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM. See
``tools/_auth.py`` and §1.3b-E2E-3.
"""
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get
from tools._auth import user_id_from_config


@tool
async def diff_revision(
    note_id: str, rev_a: str, rev_b: str, *, config: RunnableConfig
) -> object:
    """Compute a diff between two revisions of a note.

    Args:
        note_id: Note UUID.
        rev_a: Earlier revision identifier (timestamp or revision ID).
        rev_b: Later revision identifier.
    """
    user_id = user_id_from_config(config)
    return await km_get(
        f"/api/notes/{note_id}/revisions/diff?rev_a={rev_a}&rev_b={rev_b}",
        user_id=user_id,
    )


@tool
async def week_summary(weeks: int = 1, *, config: RunnableConfig) -> object:
    """Summarise the calling user's writing activity over the past N weeks.

    Args:
        weeks: Number of weeks to look back (default 1).
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/activity/summary?weeks={weeks}", user_id=user_id)


@tool
async def activity(days: int = 1, *, config: RunnableConfig) -> object:
    """Get raw activity feed for the past N days.

    Args:
        days: Number of days to look back (default 1).
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/activity?days={days}", user_id=user_id)


TOOLS = [diff_revision, week_summary, activity]
