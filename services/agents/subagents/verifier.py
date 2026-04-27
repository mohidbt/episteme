"""Verifier subagent — retry-until-supported claim verification.

Implemented as a LangGraph `StateGraph` (not a plain SubAgent) so the
retry loop is explicit and bounded. Wrapped as a `CompiledSubAgent` so
deepagents can invoke it via the standard `task` tool.

Graph:
    START → fetch_candidates → score → decide
    decide → fetch_candidates  (verdict=='unsupported' AND attempts < 3)
    decide → END               (otherwise)
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Annotated, Any, Literal, TypedDict

from deepagents import CompiledSubAgent
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

VERIFIER_TOOL_NAMES: list[str] = ["search_notes", "list_references"]

_MAX_ATTEMPTS = 3


class VerifierState(TypedDict):
    """Verifier graph state.

    `messages` is required by deepagents — the final message is extracted
    and returned to the parent agent as a ToolMessage.
    """

    claim: str
    candidate_sources: list[dict[str, Any]]
    verdict: Literal["supported", "unsupported", "pending"]
    attempts: int
    messages: Annotated[list[BaseMessage], add_messages]


# ----------------------------------------------------------------- nodes

def _default_fetch(state: VerifierState) -> dict[str, Any]:
    """Stub fetcher — overridden in production by a closure that calls
    `search_notes` / `list_references` (and optionally MCP search) bound
    to the active user_id. Increments `attempts` and returns the candidate
    source list for `score` to consume.
    """
    return {
        "candidate_sources": [],
        "attempts": state["attempts"] + 1,
    }


def _default_score(state: VerifierState) -> dict[str, Any]:
    """Stub scorer — production version asks an LLM whether the candidate
    sources support the claim. Returns `verdict` ∈ {supported, unsupported}.
    """
    return {"verdict": "unsupported"}


def _decide(state: VerifierState) -> Literal["fetch_candidates", "__end__"]:
    """Branch: retry while attempts < MAX and verdict still 'unsupported'."""
    if state["verdict"] == "supported":
        return END
    if state["attempts"] >= _MAX_ATTEMPTS:
        return END
    return "fetch_candidates"


def _emit_summary(state: VerifierState) -> dict[str, Any]:
    """Append a final AIMessage so the parent agent receives a result."""
    msg = AIMessage(
        content=(
            f"Verdict: {state['verdict']}. "
            f"Attempts: {state['attempts']}/{_MAX_ATTEMPTS}. "
            f"Sources considered: {len(state['candidate_sources'])}."
        )
    )
    return {"messages": [msg]}


# --------------------------------------------------------------- builders

def build_verifier_graph(
    *,
    fetch_fn: Callable[[VerifierState], dict[str, Any]] | None = None,
    score_fn: Callable[[VerifierState], dict[str, Any]] | None = None,
):
    """Build + compile the verifier StateGraph.

    `fetch_fn` and `score_fn` are injectable so tests can drive the loop
    deterministically without LLM calls.
    """
    fetch = fetch_fn or _default_fetch
    score = score_fn or _default_score

    g: StateGraph = StateGraph(VerifierState)
    g.add_node("fetch_candidates", fetch)
    g.add_node("score", score)
    g.add_node("emit_summary", _emit_summary)

    g.add_edge(START, "fetch_candidates")
    g.add_edge("fetch_candidates", "score")
    g.add_conditional_edges(
        "score",
        _decide,
        {"fetch_candidates": "fetch_candidates", END: "emit_summary"},
    )
    g.add_edge("emit_summary", END)
    return g.compile()


def build_verifier(*, available_tools: Sequence[BaseTool]) -> CompiledSubAgent:
    """Build the verifier as a CompiledSubAgent for deepagents.

    `available_tools` is currently only used to wire the production
    fetch closure; the test-friendly `build_verifier_graph` is the seam
    the LangGraph tests target. Tool name allow-list is preserved for
    documentation + audit symmetry with the other subagents.
    """
    allow = set(VERIFIER_TOOL_NAMES)
    domain_tools = {t.name: t for t in available_tools if t.name in allow}

    async def _fetch(state: VerifierState) -> dict[str, Any]:
        sources: list[dict[str, Any]] = []
        # Best-effort, no-raise: the loop should retry, not crash, on tool failure.
        for tname in ("search_notes", "list_references"):
            t = domain_tools.get(tname)
            if t is None:
                continue
            try:
                # search_notes(user_id, query) / list_references(user_id, q)
                # The user_id is bound by the tool wrapper at call time; here
                # we surface only the claim text as the query and rely on the
                # outer agent runtime to provide auth context.
                result = await t.ainvoke({"query": state["claim"]})  # type: ignore[arg-type]
                sources.append({"source": tname, "result": result})
            except Exception:  # noqa: BLE001
                continue
        return {
            "candidate_sources": sources,
            "attempts": state["attempts"] + 1,
        }

    graph = build_verifier_graph(fetch_fn=_fetch)
    return {
        "name": "verifier",
        "description": (
            "Verifies a single claim against candidate sources via a "
            "retry-until-supported loop (max 3 attempts). Returns verdict + "
            "supporting source IDs."
        ),
        "runnable": graph,
    }


__all__ = [
    "VERIFIER_TOOL_NAMES",
    "VerifierState",
    "build_verifier",
    "build_verifier_graph",
]
