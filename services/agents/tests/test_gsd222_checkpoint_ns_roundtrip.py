"""GSD-222 root-cause regression: the ns/thread keying `invoke` writes under
MUST match the keying `state` reads under, through a REAL langgraph root graph
+ real saver round-trip (no mocked `aget_tuple`).

Prior GSD-222 tests mocked `aget_tuple` to return a tuple whose `checkpoint_ns`
equals the caller's tenant namespace — a fiction. Installed langgraph 1.1.6
resets a caller-supplied `checkpoint_ns` to "" for the ROOT graph
(`pregel/_loop.py:273-277`) and PUTs the checkpoint under "" (`_loop.py:832-840`),
while the saver keys storage by `checkpoint_ns` (`postgres/aio.py:189-195`). So
writing with `checkpoint_ns=tenant-<sha>` (GSD-207) and reading with the same ns
finds NOTHING — the write actually landed under "".

These tests exercise the real write path (compiled root graph + MemorySaver,
config from `_build_configurable`) and the real read path (saver.aget_tuple with
`_checkpoint_lookup_config`) and assert the message round-trips AND that a foreign
tenant reusing the same client thread_id cannot read it.
"""
import operator
from typing import Annotated, TypedDict

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import START, StateGraph

from routers.km_agent import (  # noqa: E402
    _build_configurable,
    _checkpoint_lookup_config,
)

CALLER = "user_alice"
OTHER = "user_bob"
CLIENT_THREAD_ID = "thread-shared-123"


class _State(TypedDict):
    messages: Annotated[list, operator.add]


def _compile_root_graph(saver: MemorySaver):
    """A minimal REAL root Pregel graph — same shape create_deep_agent compiles
    (root graph, checkpointer attached) for the ns keying that matters here."""

    def echo(state: _State) -> dict:
        return {"messages": [HumanMessage(content="assistant reply", id="a-1")]}

    return (
        StateGraph(_State)
        .add_node("echo", echo)
        .add_edge(START, "echo")
        .compile(checkpointer=saver)
    )


async def _write_turn(graph, *, thread_id: str, user_id: str) -> None:
    """Write a checkpoint through the EXACT config shape `invoke` builds."""
    configurable = _build_configurable(
        thread_id=thread_id,
        user_id=user_id,
        auth={"llm_key": "k", "ocr_key": "k"},
        active_paper_id=None,
    )
    await graph.ainvoke(
        {"messages": [HumanMessage(content="hello", id="h-1")]},
        config={"configurable": configurable},
    )


@pytest.mark.asyncio
async def test_invoke_write_is_readable_by_state_lookup():
    """RED before fix: state's aget_tuple returns None because invoke wrote
    under checkpoint_ns="" while state reads under tenant-<sha>."""
    saver = MemorySaver()
    graph = _compile_root_graph(saver)

    await _write_turn(graph, thread_id=CLIENT_THREAD_ID, user_id=CALLER)

    read_config = _checkpoint_lookup_config(
        thread_id=CLIENT_THREAD_ID, user_id=CALLER
    )
    tuple_ = await saver.aget_tuple(read_config)

    assert tuple_ is not None, (
        "state lookup found no checkpoint — write-ns != read-ns "
        "(GSD-222 root cause)"
    )
    msgs = tuple_.checkpoint["channel_values"]["messages"]
    assert any(getattr(m, "id", None) == "a-1" for m in msgs)


@pytest.mark.asyncio
async def test_foreign_tenant_cannot_read_same_client_thread_id():
    """Tenant isolation (GSD-207 goal): tenant Bob reusing Alice's client
    thread_id must NOT resolve Alice's checkpoint."""
    saver = MemorySaver()
    graph = _compile_root_graph(saver)

    # Alice writes under the shared client thread_id.
    await _write_turn(graph, thread_id=CLIENT_THREAD_ID, user_id=CALLER)

    # Bob reads the same client thread_id — must get nothing.
    bob_config = _checkpoint_lookup_config(
        thread_id=CLIENT_THREAD_ID, user_id=OTHER
    )
    tuple_ = await saver.aget_tuple(bob_config)

    assert tuple_ is None, "cross-tenant leak: Bob resolved Alice's checkpoint"
