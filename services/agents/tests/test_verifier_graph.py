"""Tests for the verifier LangGraph state-transition logic.

The verifier graph implements a retry-until-supported loop:

    fetch_candidates -> score -> decide
    decide -> fetch_candidates  (if attempts < 3 and verdict == 'unsupported')
    decide -> END               (otherwise)

We test the decision logic directly (no LLM calls) by injecting a stub
scoring function that returns deterministic verdicts.
"""
from __future__ import annotations

import pytest

from subagents.verifier import VerifierState, build_verifier_graph


def _identity_fetch(state: VerifierState) -> dict:
    """Stub fetch — returns an empty source list and bumps attempts."""
    return {
        "candidate_sources": [{"id": "stub", "score": 0}],
        "attempts": state["attempts"] + 1,
    }


def _always_supported_score(state: VerifierState) -> dict:
    return {"verdict": "supported"}


def _always_unsupported_score(state: VerifierState) -> dict:
    return {"verdict": "unsupported"}


@pytest.mark.asyncio
async def test_verifier_terminates_on_supported_verdict():
    graph = build_verifier_graph(
        fetch_fn=_identity_fetch,
        score_fn=_always_supported_score,
    )
    result = await graph.ainvoke({
        "claim": "The sky is blue.",
        "candidate_sources": [],
        "verdict": "pending",
        "attempts": 0,
        "messages": [],
    })
    assert result["verdict"] == "supported"
    assert result["attempts"] == 1  # one fetch+score cycle


@pytest.mark.asyncio
async def test_verifier_retries_until_max_attempts_when_unsupported():
    graph = build_verifier_graph(
        fetch_fn=_identity_fetch,
        score_fn=_always_unsupported_score,
    )
    result = await graph.ainvoke({
        "claim": "Cold fusion is real.",
        "candidate_sources": [],
        "verdict": "pending",
        "attempts": 0,
        "messages": [],
    })
    assert result["attempts"] == 3
    assert result["verdict"] == "unsupported"


@pytest.mark.asyncio
async def test_verifier_emits_messages_summary():
    """The graph must populate `messages` so deepagents can extract the result."""
    graph = build_verifier_graph(
        fetch_fn=_identity_fetch,
        score_fn=_always_supported_score,
    )
    result = await graph.ainvoke({
        "claim": "Water boils at 100C at sea level.",
        "candidate_sources": [],
        "verdict": "pending",
        "attempts": 0,
        "messages": [],
    })
    assert result["messages"], "verifier must produce at least one message"
    final = result["messages"][-1]
    # The final message content carries the verdict for the parent agent.
    content = final.content if hasattr(final, "content") else final.get("content", "")
    assert "supported" in content.lower()
