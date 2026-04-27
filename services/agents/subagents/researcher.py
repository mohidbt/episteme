"""Researcher subagent — read-only literature retrieval.

Tool allow-list (string names): MCP search tools (arxiv/biorxiv/pubmed/web)
plus the user's library + notes lookup. NEVER any write tools.
"""
from __future__ import annotations

from collections.abc import Sequence

from deepagents import SubAgent
from langchain_core.tools import BaseTool

RESEARCHER_TOOL_NAMES: list[str] = [
    "arxiv_search",
    "biorxiv_search",
    "pubmed_search",
    "web_search",
    "list_references",
    "search_notes",
]

_DESCRIPTION = (
    "Fetches external literature + cross-references the user's library. Never writes."
)

_SYSTEM_PROMPT = """You are a scientific research assistant.

Your job is to retrieve sources — never to fabricate them.

- Use the MCP search tools (arxiv_search, biorxiv_search, pubmed_search, web_search)
  for external literature; use `list_references` and `search_notes` to ground
  results in the user's existing library.
- Return citations with DOI or arXiv ID where available; for web results return
  the URL and the publication date.
- No speculation. If a source cannot be retrieved, say so explicitly rather
  than inventing details.
- You have NO write tools. You cannot create notes, highlight, or publish.
"""


def build_researcher(*, available_tools: Sequence[BaseTool]) -> SubAgent:
    """Build the researcher SubAgent spec.

    `available_tools` is filtered down to the names in
    `RESEARCHER_TOOL_NAMES`; tools not in the allow-list are dropped so a
    misconfigured caller can't accidentally hand the researcher a write tool.
    """
    allow = set(RESEARCHER_TOOL_NAMES)
    tools = [t for t in available_tools if t.name in allow]
    return {
        "name": "researcher",
        "description": _DESCRIPTION,
        "system_prompt": _SYSTEM_PROMPT,
        "tools": tools,
    }


__all__ = ["RESEARCHER_TOOL_NAMES", "build_researcher"]
