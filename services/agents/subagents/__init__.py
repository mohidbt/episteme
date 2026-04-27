"""Subagents for the KM Deep Agent — researcher / synthesizer / verifier.

Each subagent is published as:
- A `*_TOOL_NAMES` constant (string allow-list, asserted in tests).
- A `build_*` factory that resolves names against caller-supplied tool
  instances and returns a deepagents `SubAgent` (or `CompiledSubAgent` for
  the verifier) TypedDict ready to pass to `create_deep_agent`.

The string allow-list is the documented contract; the factory adapts it
into the concrete BaseTool instances the deepagents middleware expects.
"""
from __future__ import annotations

from .researcher import RESEARCHER_TOOL_NAMES, build_researcher
from .synthesizer import SYNTHESIZER_TOOL_NAMES, build_synthesizer
from .verifier import VERIFIER_TOOL_NAMES, build_verifier, build_verifier_graph

ALL_SUBAGENTS: list[str] = ["researcher", "synthesizer", "verifier"]
"""Canonical subagent names — the universe of names a skill may reference."""

__all__ = [
    "ALL_SUBAGENTS",
    "RESEARCHER_TOOL_NAMES",
    "SYNTHESIZER_TOOL_NAMES",
    "VERIFIER_TOOL_NAMES",
    "build_researcher",
    "build_synthesizer",
    "build_verifier",
    "build_verifier_graph",
]
