"""LangChain tools for revision history and activity in apps/km."""
from langchain_core.tools import tool

from lib.km_http import km_get


@tool
async def diff_revision(user_id: str, note_id: str, rev_a: str, rev_b: str) -> object:
    """Compute a diff between two revisions of a note.

    Args:
        user_id: The authenticated user's ID.
        note_id: Note UUID.
        rev_a: Earlier revision identifier (timestamp or revision ID).
        rev_b: Later revision identifier.
    """
    return await km_get(
        f"/api/notes/{note_id}/revisions/diff?rev_a={rev_a}&rev_b={rev_b}",
        user_id=user_id,
    )


@tool
async def week_summary(user_id: str, weeks: int = 1) -> object:
    """Summarise the user's writing activity over the past N weeks.

    Args:
        user_id: The authenticated user's ID.
        weeks: Number of weeks to look back (default 1).
    """
    return await km_get(f"/api/activity/summary?weeks={weeks}", user_id=user_id)


@tool
async def activity(user_id: str, days: int = 1) -> object:
    """Get raw activity feed for the past N days.

    Args:
        user_id: The authenticated user's ID.
        days: Number of days to look back (default 1).
    """
    return await km_get(f"/api/activity?days={days}", user_id=user_id)


TOOLS = [diff_revision, week_summary, activity]
