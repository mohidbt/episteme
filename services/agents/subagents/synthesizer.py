"""Synthesizer subagent — drafts cited markdown reports into /scratch.

Domain tool allow-list is read-only (`search_notes`, `read_note`). Writes
to `/scratch/<slug>.md` happen via the deepagents filesystem middleware
(built-in `write_file` tool), which deepagents adds to every subagent's
default stack — no domain write tools are required (or permitted).
"""
from __future__ import annotations

from collections.abc import Sequence

from deepagents import SubAgent
from langchain_core.tools import BaseTool

SYNTHESIZER_TOOL_NAMES: list[str] = ["search_notes", "read_note"]

_DESCRIPTION = (
    "Drafts a cited markdown synthesis from the user's notes + PDFs into "
    "/scratch for review. Read-only against the knowledge base."
)

# The citation rule is hard-coded VERBATIM — any change here is a behavioural
# change reviewers must catch.
_SYSTEM_PROMPT = """You are a synthesis assistant.

Your task is to compose a clear, accurately-cited markdown draft of the
requested topic from the sources you are given.

CITATION RULE — non-negotiable:
Every claim MUST be followed by a citation — [[Note]], PDF anchor, or URL. \
Flag gaps explicitly with "⚠ unsupported".

- Read sources via `search_notes` and `read_note`. Do not call any write or
  publish tools — your only output channel is the filesystem `write_file`
  tool, which writes the draft to `/scratch/<slug>.md`.
- One claim per sentence is preferable; group claims with a shared source
  under a single trailing citation.
- If you cannot find a source for a claim, write the claim and append
  "⚠ unsupported" — do not silently drop the claim and do not invent a
  citation.
- Do not promote the draft to a real note; the parent agent will request
  user confirmation before doing so.
"""


def build_synthesizer(*, available_tools: Sequence[BaseTool]) -> SubAgent:
    """Build the synthesizer SubAgent spec."""
    allow = set(SYNTHESIZER_TOOL_NAMES)
    tools = [t for t in available_tools if t.name in allow]
    return {
        "name": "synthesizer",
        "description": _DESCRIPTION,
        "system_prompt": _SYSTEM_PROMPT,
        "tools": tools,
    }


__all__ = ["SYNTHESIZER_TOOL_NAMES", "build_synthesizer"]
