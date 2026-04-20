"""Unit tests for lib.chat.run_chat agent loop."""
import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

from lib.chat import run_chat  # noqa: E402


def _fake_agent(events):
    """Build a fake agent whose astream yields the given (mode, payload) tuples."""
    fake = MagicMock()

    async def astream(_input, config=None, *, stream_mode=None, **kwargs):
        for ev in events:
            yield ev

    fake.astream = astream
    return fake


@pytest.mark.asyncio
async def test_run_chat_no_tools_yields_token_events():
    from langchain_core.messages import AIMessageChunk

    events = [
        ("messages", (AIMessageChunk(content="Hello "), {})),
        ("messages", (AIMessageChunk(content="world"), {})),
    ]

    with patch("lib.chat.create_agent", return_value=_fake_agent(events)):
        out = []
        async for ev in run_chat(
            api_key="sk-test", history=[], question="hi",
            supporting_chunks=[], page_text=None, anchor_text=None,
            selection_text=None, scope="paper", focus_page=None, tools=None,
        ):
            out.append(ev)

    assert out == [("token", "Hello "), ("token", "world")]
    assert all(ev[0] != "tool_call" for ev in out)


@pytest.mark.asyncio
async def test_run_chat_emits_tool_call_and_result():
    from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

    events = [
        ("messages", (AIMessageChunk(content="thinking"), {})),
        ("updates", {"model": {"messages": [
            AIMessage(content="", tool_calls=[
                {"name": "search", "args": {"q": "foo"}, "id": "c1", "type": "tool_call"},
            ])
        ]}}),
        ("updates", {"tools": {"messages": [
            ToolMessage(content="result-text", tool_call_id="c1", name="search"),
        ]}}),
    ]

    with patch("lib.chat.create_agent", return_value=_fake_agent(events)):
        out = []
        async for ev in run_chat(
            api_key="sk-test", history=[], question="hi",
            supporting_chunks=[], page_text=None, anchor_text=None,
            selection_text=None, scope="paper", focus_page=None, tools=[],
        ):
            out.append(ev)

    assert ("token", "thinking") in out
    assert ("tool_call", "search", {"q": "foo"}) in out
    assert ("tool_result", "search", "result-text") in out


@pytest.mark.asyncio
async def test_run_chat_includes_tool_hints_in_system_prompt():
    """When tool_hints is passed, the first (system) message should contain the hint text."""
    captured: dict = {}

    fake = MagicMock()

    async def astream(input_, config=None, *, stream_mode=None, **kwargs):
        captured["messages"] = input_.get("messages", [])
        return
        yield  # pragma: no cover — make it an async generator

    fake.astream = astream

    with patch("lib.chat.create_agent", return_value=fake):
        async for _ in run_chat(
            api_key="sk-test", history=[], question="hi",
            supporting_chunks=[], page_text=None, anchor_text=None,
            selection_text=None, scope="paper", focus_page=None, tools=[],
            tool_hints=["HINT_TEXT_SENTINEL"],
        ):
            pass

    assert captured["messages"], "expected at least one message"
    system_msg = captured["messages"][0]
    assert system_msg["role"] == "system"
    assert "HINT_TEXT_SENTINEL" in system_msg["content"]


@pytest.mark.asyncio
async def test_run_chat_without_tool_hints_omits_hint_text():
    """When tool_hints is None, no hint text appears in the system prompt."""
    captured: dict = {}

    fake = MagicMock()

    async def astream(input_, config=None, *, stream_mode=None, **kwargs):
        captured["messages"] = input_.get("messages", [])
        return
        yield  # pragma: no cover

    fake.astream = astream

    with patch("lib.chat.create_agent", return_value=fake):
        async for _ in run_chat(
            api_key="sk-test", history=[], question="hi",
            supporting_chunks=[], page_text=None, anchor_text=None,
            selection_text=None, scope="paper", focus_page=None, tools=[],
            tool_hints=None,
        ):
            pass

    system_msg = captured["messages"][0]
    assert system_msg["role"] == "system"
    assert "HINT_TEXT_SENTINEL" not in system_msg["content"]


@pytest.mark.asyncio
async def test_run_chat_skips_list_content_chunks():
    """AIMessageChunk.content can be a list (e.g. tool-call blocks); must not yield as token."""
    from langchain_core.messages import AIMessageChunk

    events = [
        ("messages", (AIMessageChunk(content="hello "), {})),
        ("messages", (AIMessageChunk(content=[
            {"type": "tool_use", "name": "search", "input": {"q": "foo"}, "id": "c1"},
        ]), {})),
        ("messages", (AIMessageChunk(content="world"), {})),
    ]

    with patch("lib.chat.create_agent", return_value=_fake_agent(events)):
        out = []
        async for ev in run_chat(
            api_key="sk-test", history=[], question="hi",
            supporting_chunks=[], page_text=None, anchor_text=None,
            selection_text=None, scope="paper", focus_page=None, tools=None,
        ):
            out.append(ev)

    token_events = [ev for ev in out if ev[0] == "token"]
    assert token_events == [("token", "hello "), ("token", "world")]
    assert all(isinstance(ev[1], str) for ev in token_events)
