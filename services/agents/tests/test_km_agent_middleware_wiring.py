"""Wire test: GroundingGuard is passed to create_deep_agent by build_km_agent.

RED: GroundingGuard not yet wired in km_agent.py → assertion fails.
GREEN: wire middleware=[GroundingGuard()] in build_km_agent.
"""
from __future__ import annotations

from typing import List
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


# Minimal fake model (pattern from test_km_agent_system_prompt.py)
class _NopModel(BaseChatModel):
    captured: list = []

    @property
    def _llm_type(self) -> str:
        return "fake"

    def _generate(self, messages: List[BaseMessage], **kwargs) -> ChatResult:
        self.captured.append(messages)
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content="done", tool_calls=[]))]
        )

    def bind_tools(self, tools, **kwargs):  # type: ignore[override]
        return self


@pytest.mark.asyncio
async def test_grounding_guard_present_in_extract_route():
    """build_km_agent must pass GroundingGuard via middleware= to create_deep_agent.

    We patch create_deep_agent to capture kwargs, then assert a GroundingGuard
    instance is in the middleware list.  This is the most reliable approach
    because deepagents compiles the middleware list into a closure — it doesn't
    remain as a list on the compiled graph.
    """
    from middleware.grounding_guard import GroundingGuard  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    mock_specs = load_skills(only=["data-extract"])
    model = _NopModel(captured=[])

    import km_agent as _km_agent_module  # noqa: PLC0415

    real_create_deep_agent = _km_agent_module.create_deep_agent
    captured_kwargs: dict = {}

    def _capture(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return real_create_deep_agent(*args, **kwargs)

    with (
        patch("km_agent.DriveSkillsLoader") as MockLoader,
        patch("km_agent._fetch_personal_skills", new=AsyncMock(return_value=[])),
        patch("km_agent.create_deep_agent", side_effect=_capture),
    ):
        MockLoader.return_value.load = AsyncMock(return_value=mock_specs)
        await _km_agent_module.build_km_agent(
            user_id="u1",
            thread_id="t1",
            model=model,
            enabled_skills=["data-extract"],
            approval_rules={},
            store=InMemoryStore(),
            saver=MemorySaver(),
        )

    middleware_list = captured_kwargs.get("middleware", [])
    guard_present = any(isinstance(m, GroundingGuard) for m in middleware_list)

    assert guard_present, (
        f"GroundingGuard not in middleware= passed to create_deep_agent. "
        f"Got: {middleware_list!r}. "
        "Wire middleware=[GroundingGuard()] in km_agent.py build_km_agent."
    )
