"""BG0: System prompt must explicitly steer list_pdfs vs search_pdfs choice.

Tool docstrings alone don't reliably steer the model — the system prompt
weighs more. Assert the explicit rule string is present in the model-facing
system prompt.
"""
from __future__ import annotations

from typing import List
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


class _CapturingFakeModel(BaseChatModel):
    captured_inputs: list = []

    @property
    def _llm_type(self) -> str:
        return "fake"

    def _generate(self, messages: List[BaseMessage], **kwargs) -> ChatResult:
        self.captured_inputs.append(list(messages))
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content="done", tool_calls=[]))]
        )

    def bind_tools(self, tools, **kwargs):  # type: ignore[override]
        return self


def _extract_system_text(messages: list) -> str:
    sys_msgs = [m for m in messages if isinstance(m, SystemMessage)]
    assert sys_msgs, "No SystemMessage found"
    content = sys_msgs[0].content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


@pytest.mark.asyncio
async def test_system_prompt_contains_list_vs_search_pdfs_rule():
    """The model-facing system prompt must contain an explicit rule telling
    the model to call list_pdfs (not search_pdfs) for vague library queries."""
    from km_agent import build_km_agent  # noqa: PLC0415

    model = _CapturingFakeModel(captured_inputs=[])
    with (
        patch("km_agent.DriveSkillsLoader") as MockLoader,
        patch("km_agent._fetch_personal_skills", new=AsyncMock(return_value=[])),
    ):
        MockLoader.return_value.load = AsyncMock(return_value=[])
        agent = await build_km_agent(
            user_id="u1",
            thread_id="t1",
            model=model,
            enabled_skills=[],
            approval_rules={},
            store=InMemoryStore(),
            saver=MemorySaver(),
        )

    agent.invoke(
        {"messages": [HumanMessage(content="hello")]},
        config={"configurable": {"thread_id": "t1"}, "recursion_limit": 10},
    )

    assert model.captured_inputs, "fake model never called"
    system_text = _extract_system_text(model.captured_inputs[0])

    # Marker phrase the prod prompt must contain.
    assert "IMPORTANT TOOL CHOICE RULE" in system_text, (
        "System prompt missing 'IMPORTANT TOOL CHOICE RULE' marker"
    )
    assert "list_pdfs" in system_text and "search_pdfs" in system_text, (
        "Rule must reference both list_pdfs and search_pdfs by name"
    )
    # Must steer toward list_pdfs as the default for vague library queries.
    assert "Never default to `search_pdfs`" in system_text, (
        "Rule must explicitly forbid defaulting to search_pdfs"
    )
