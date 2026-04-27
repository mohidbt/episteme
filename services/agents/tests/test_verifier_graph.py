"""Tests for the verifier LangGraph state-transition logic.

The verifier graph implements a retry-until-supported loop:

    fetch_candidates -> score -> decide
    decide -> fetch_candidates  (if attempts < 3 and verdict == 'unsupported')
    decide -> END               (otherwise)

We test the decision logic directly (no LLM calls) by injecting a stub
scoring function that returns deterministic verdicts.
"""
from __future__ import annotations

import logging

import pytest
from langchain_core.tools import tool

import subagents.verifier as verifier_mod
from subagents.verifier import VERIFIER_TOOL_NAMES, VerifierState, build_verifier, build_verifier_graph


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


# ------------------------------------------- production runnable end-to-end


@pytest.mark.asyncio
async def test_build_verifier_runnable_end_to_end_with_score_fn():
    """Production `build_verifier` must produce a runnable that terminates
    when a real `score_fn` is supplied (regression: stub scorer always
    returned 'unsupported' so production exhausted 3 attempts).
    """

    @tool("search_notes")
    async def stub_search_notes(query: str) -> list[dict]:  # noqa: ARG001
        """Stub."""
        return [{"id": "n1", "title": "stub"}]

    def score_supported(state: VerifierState) -> dict:
        return {"verdict": "supported"}

    spec = build_verifier(
        available_tools=[stub_search_notes],
        score_fn=score_supported,
    )
    runnable = spec["runnable"]
    result = await runnable.ainvoke({
        "claim": "x",
        "candidate_sources": [],
        "verdict": "pending",
        "attempts": 0,
        "messages": [],
    })

    assert result["verdict"] == "supported"
    assert result["attempts"] == 1
    assert result["messages"], "must emit a summary message"
    final = result["messages"][-1]
    content = final.content if hasattr(final, "content") else final.get("content", "")
    assert "supported" in content.lower()


# ------------------------------------------- score_fn warning


@pytest.mark.asyncio
async def test_build_verifier_warns_and_falls_back_when_score_fn_missing(caplog):
    """When `score_fn` is None, log a one-shot warning and fall back to the
    stub scorer (which always returns 'unsupported' → 3 attempts → END).
    """
    # Reset the module-level dedupe flag so the warning fires for this test.
    verifier_mod._warned_no_score_fn = False  # type: ignore[attr-defined]

    @tool("search_notes")
    async def stub_search_notes(query: str) -> list[dict]:  # noqa: ARG001
        """Stub."""
        return []

    with caplog.at_level(logging.WARNING, logger=verifier_mod.__name__):
        spec = build_verifier(available_tools=[stub_search_notes])

    assert any(
        "score_fn" in rec.message and "unsupported" in rec.message
        for rec in caplog.records
    ), f"expected warning about missing score_fn, got: {[r.message for r in caplog.records]}"

    runnable = spec["runnable"]
    result = await runnable.ainvoke({
        "claim": "x",
        "candidate_sources": [],
        "verdict": "pending",
        "attempts": 0,
        "messages": [],
    })
    assert result["verdict"] == "unsupported"
    assert result["attempts"] == 3


def test_build_verifier_warns_only_once_per_process(caplog):
    """The dedupe flag must suppress the warning on subsequent calls."""
    verifier_mod._warned_no_score_fn = False  # type: ignore[attr-defined]

    with caplog.at_level(logging.WARNING, logger=verifier_mod.__name__):
        build_verifier(available_tools=[])
        first_count = sum(
            1 for r in caplog.records if "score_fn" in r.message
        )
        build_verifier(available_tools=[])
        second_count = sum(
            1 for r in caplog.records if "score_fn" in r.message
        )

    assert first_count == 1
    assert second_count == 1, "warning must not repeat on subsequent calls"
