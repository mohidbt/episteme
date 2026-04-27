"""Helper to extract the authenticated user_id from a RunnableConfig.

Tools never accept user_id from the LLM — the agent factory / router injects
it into ``config["configurable"]["user_id"]`` at /invoke time so that the
calling user is always the source of truth (see §1.3b-E2E-3).
"""
from __future__ import annotations

from langchain_core.runnables import RunnableConfig


def user_id_from_config(config: RunnableConfig | None) -> str:
    """Return the user_id from the per-invoke RunnableConfig.

    Raises:
        ValueError: If ``configurable.user_id`` is missing/empty. This indicates
            the agent was invoked without an authenticated user — a bug in the
            caller (see services/agents/routers/km_agent.py).
    """
    cfg = (config or {}).get("configurable") or {}
    user_id = cfg.get("user_id")
    if not user_id:
        raise ValueError(
            "tool invoked without configurable.user_id — agent factory must "
            "inject user_id into RunnableConfig (see §1.3b-E2E-3)"
        )
    return user_id
