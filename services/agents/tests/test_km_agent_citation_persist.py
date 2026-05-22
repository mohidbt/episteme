"""G6.1 RED — citation persistence must handle ``run--`` AIMessage.id prefix.

LangChain assigns ``AIMessage.id = "run--<run_id>"`` to checkpoint messages, but
the streaming loop in :func:`routers.km_agent.invoke.gen` buffers citations
keyed by the raw ``run_id`` (e.g. ``abc-123``). The persist loop in
:func:`routers.km_agent._persist_citations_into_checkpoint` then fails to find
the buffered citations because the checkpoint id (``run--abc-123``) never
matches the buffer key.

This regression test reproduces the mismatch and asserts that the persist
function still issues an ``aupdate_state`` call with a non-empty ``updates``
list.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

from routers.km_agent import _persist_citations_into_checkpoint  # noqa: E402


@pytest.mark.asyncio
async def test_persist_matches_checkpoint_id_with_run_prefix() -> None:
    from langchain_core.messages import AIMessage, HumanMessage  # noqa: PLC0415

    raw_run_id = "raw-uuid-1"
    checkpoint_msg = AIMessage(
        content="answer",
        id=f"run--{raw_run_id}",
        additional_kwargs={},
    )
    human = HumanMessage(content="q", id="u-1")

    snap = MagicMock()
    snap.values = {"messages": [human, checkpoint_msg]}

    agent = MagicMock()
    agent.aget_state = AsyncMock(return_value=snap)
    agent.aupdate_state = AsyncMock(return_value=None)

    citations = [
        {
            "chunk_id": "paper-1:p4:7",
            "paper_id": "paper-1",
            "title": "Attention Is All You Need - Page 4",
            "score": 0.91,
            "snippet": "Block 7 text",
            "page": 4,
            "bbox": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0},
        }
    ]
    citations_by_msg_id = {raw_run_id: citations}

    await _persist_citations_into_checkpoint(
        agent=agent,
        thread_id="thread-1",
        citations_by_msg_id=citations_by_msg_id,
    )

    assert agent.aupdate_state.await_count == 1, (
        "expected aupdate_state to be called exactly once with citation updates"
    )
    call_args = agent.aupdate_state.await_args
    # Second positional arg is the state-update dict.
    state_update = call_args.args[1]
    updates = state_update["messages"]
    assert len(updates) == 1, f"expected 1 message update, got {len(updates)}"
    persisted = updates[0]
    assert persisted.id == f"run--{raw_run_id}"
    assert persisted.additional_kwargs.get("citations") == citations
