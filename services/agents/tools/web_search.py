"""Tavily-backed web_search tool — BACKUP / LAST RESORT only.

Wired per the LangChain deep-research guide
(https://docs.langchain.com/oss/python/deepagents/deep-research): a thin
`@tool` wrapper around `tavily-python`'s `TavilyClient.search()`. We do NOT
fetch and markdownify each result page (the guide's optional second step) —
Tavily's own `content` field already contains a usable snippet, and adding a
fetch+markdownify pass would double the dependency surface for marginal gain.

Set `TAVILY_API_KEY` in the agents service environment to enable. The tool
is bound to the agent by default (K12) — users may explicitly opt out by
setting `permissions.web_search = false` in their agent config.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def _maybe_notify_tavily_exhaustion(exc: Exception) -> None:
    """Best-effort fire-and-forget alert for TAVILY_API_KEY exhaustion.

    Tavily's SDK raises `tavily.errors.InvalidAPIKeyError` (401) and
    `UsageLimitExceededError` (429). We schedule the async notifier as a
    background task so this tool stays sync-safe for LangChain @tool callers.
    """
    msg = str(exc)
    low = msg.lower()
    if "invalid" in low and "api" in low and "key" in low:
        status = 401
    elif "usage" in low and "limit" in low:
        status = 429
    elif "rate" in low and "limit" in low:
        status = 429
    elif "402" in low or "payment" in low or "insufficient" in low:
        status = 402
    else:
        return
    try:
        import asyncio  # noqa: PLC0415
        from lib.key_health import (  # noqa: PLC0415
            classify_provider_error,
            record_and_maybe_alert,
        )
        from deps import db as db_module  # noqa: PLC0415

        reason = classify_provider_error(status, msg)
        if reason is None:
            return

        async def _go() -> None:
            await record_and_maybe_alert(
                db_module._pool,
                provider="tavily",
                env_var="TAVILY_API_KEY",
                reason=reason,
                sample_error=msg[:1000],
            )

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(_go())
    except Exception:  # noqa: BLE001
        logger.exception("tavily key-health notify failed")

_MAX_RESULTS = 5


def _get_client() -> Any:
    """Construct a Tavily client. Patched out in tests."""
    from tavily import TavilyClient

    return TavilyClient(api_key=os.environ["TAVILY_API_KEY"])


@tool
def web_search(query: str) -> str:
    """Web search via Tavily. USE ONLY AS A LAST RESORT, when:
    1. Internal documentation search has failed (no relevant matches in the
       user's papers/notes/references via list_notes, search_notes, list_pdfs,
       search_pdfs, list_references, get_reference), OR
    2. Specialized external search tools have failed (e.g. agentic paper
       search via agentic_search_papers, OpenAlex / Semantic Scholar lookup).

    Do NOT use for queries answerable from internal sources. This is a backup
    tool. Before invoking, you MUST have already tried the relevant internal
    or specialized tool and observed an empty/failed result. State which tool
    you tried and what it returned before falling back here.

    Returns titles, URLs, and content snippets. Cite the URL when surfacing a
    result.
    """
    if not os.environ.get("TAVILY_API_KEY"):
        logger.warning("web_search invoked but TAVILY_API_KEY is not configured")
        return (
            "web_search is not configured: TAVILY_API_KEY is missing from the "
            "agents service environment. Tell the user web search is "
            "unavailable in this deployment."
        )

    try:
        client = _get_client()
        response = client.search(query, max_results=_MAX_RESULTS)
    except Exception as exc:  # noqa: BLE001 — surface upstream failures verbatim
        logger.exception("Tavily search failed")
        _maybe_notify_tavily_exhaustion(exc)
        return f"web_search failed: {exc}"

    results = response.get("results", []) if isinstance(response, dict) else []
    if not results:
        return f"No web results for '{query}'."

    lines = [f"Found {len(results)} result(s) for '{query}':", ""]
    for r in results:
        title = r.get("title") or "(untitled)"
        url = r.get("url") or ""
        content = (r.get("content") or "").strip()
        lines.append(f"## {title}")
        lines.append(f"**URL:** {url}")
        if content:
            lines.append("")
            lines.append(content)
        lines.append("---")
    return "\n".join(lines)


TOOLS = [web_search]
