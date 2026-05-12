"""Tests for canonical SkillsMiddleware integration in build_km_agent.

RED → GREEN: after enabling skills=["/.episteme/agents/skills/"] in km_agent.py and
deleting the hand-rolled bullets block.
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

SKILLS_ROOT = "/.episteme/agents/skills/"


# ---------------------------------------------------------------------------
# Fake model that records model-facing messages and terminates the agent loop.
# ---------------------------------------------------------------------------

class _CapturingFakeModel(BaseChatModel):
    """Minimal BaseChatModel that captures every invoke call's input messages.

    Returns a no-tool AIMessage on the first call so the agent loop terminates
    immediately without needing a real LLM key.
    """

    captured_inputs: list = []

    @property
    def _llm_type(self) -> str:
        return "fake"

    def _generate(self, messages: List[BaseMessage], **kwargs) -> ChatResult:
        self.captured_inputs.append(list(messages))
        # tool_calls=[] is required to end the agent loop (no pending tool calls)
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content="done", tool_calls=[]))]
        )

    def bind_tools(self, tools, **kwargs):  # type: ignore[override]
        # Return self — captured inputs are recorded regardless of bound tools.
        return self


def _extract_system_text(messages: list) -> str:
    """Return the full text of the first SystemMessage in *messages*.

    The content may be a list of prompt-cache blocks (dicts with a 'text' key)
    or a plain string, depending on the deepagents / Anthropic middleware version.
    """
    from langchain_core.messages import SystemMessage  # noqa: PLC0415

    sys_msgs = [m for m in messages if isinstance(m, SystemMessage)]
    assert sys_msgs, "No SystemMessage found in model-facing messages"
    content = sys_msgs[0].content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


async def _run_agent_and_capture_system_prompt(
    enabled_skills: list[str],
    loaded_specs=None,
) -> str:
    """Build the real agent (no create_deep_agent patch), run one turn with the
    capturing fake model, and return the system message text the model saw.

    DriveSkillsLoader is mocked so no network call is needed.
    """
    from km_agent import build_km_agent  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    mock_specs = loaded_specs if loaded_specs is not None else load_skills(only=["data-extract"])
    model = _CapturingFakeModel(captured_inputs=[])

    with (
        patch("km_agent.DriveSkillsLoader") as MockLoader,
        patch("km_agent._fetch_personal_skills", new=AsyncMock(return_value=[])),
    ):
        MockLoader.return_value.load = AsyncMock(return_value=mock_specs)
        agent = await build_km_agent(
            user_id="u1",
            thread_id="t1",
            model=model,
            enabled_skills=enabled_skills,
            approval_rules={},
            store=InMemoryStore(),
            saver=MemorySaver(),
        )

    from langchain_core.messages import HumanMessage  # noqa: PLC0415

    agent.invoke(
        {"messages": [HumanMessage(content="hello")]},
        config={"configurable": {"thread_id": "t1"}, "recursion_limit": 10},
    )

    assert model.captured_inputs, "Fake model was never called — agent did not reach the model node"
    return _extract_system_text(model.captured_inputs[0])


# ---------------------------------------------------------------------------
# Integration test: model-facing prompt contains expected skill content
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_skills_section_advertises_reachable_path():
    """The compiled agent's first model call must include the skill name,
    its virtual SKILL.md path, 'read_file', and 'limit=1000' in the system
    message — proving SkillsMiddleware is wired and formats the prompt correctly.

    Regression guard: temporarily set skills=None in km_agent.py and this test
    fails; restore it and the test passes.
    """
    system_text = await _run_agent_and_capture_system_prompt(
        enabled_skills=["data-extract"]
    )

    assert "data-extract" in system_text, (
        "Skill name 'data-extract' missing from model-facing system prompt"
    )
    assert f"{SKILLS_ROOT}data-extract/SKILL.md" in system_text, (
        f"Reachable path '{SKILLS_ROOT}data-extract/SKILL.md' missing from system prompt"
    )
    assert "read_file" in system_text, (
        "'read_file' instruction missing from model-facing system prompt"
    )
    assert "limit=1000" in system_text, (
        "'limit=1000' instruction missing from model-facing system prompt"
    )


# ---------------------------------------------------------------------------
# Wiring-level regression guard: no hand-rolled bullets block
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_hand_rolled_bullets_block_removed():
    """system_prompt passed to create_deep_agent must NOT contain the
    hand-rolled '## Skills (workflows you execute INLINE)' marker.

    Before GREEN (RED): build_km_agent appended the hand-rolled block when
    enabled_skills was non-empty.
    """
    system_text = await _run_agent_and_capture_system_prompt(
        enabled_skills=["data-extract"]
    )

    assert "## Skills (workflows you execute INLINE)" not in system_text, (
        "Hand-rolled bullets block still present in system_prompt — "
        "delete the legacy hand-rolled block in km_agent.py"
    )


# ---------------------------------------------------------------------------
# Backend sanity check: read_file can fetch the skill body on demand
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_read_file_can_fetch_skill_body():
    """The SkillsBackend can serve the data-extract skill body via the virtual path.

    Regression lock: the agent's read_file tool uses this backend. If this path
    breaks, the model cannot read the skill's full instructions on demand.
    """
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415

    backend = SkillsBackend()
    result = await backend.aread(f"{SKILLS_ROOT}data-extract/SKILL.md")

    assert result.error is None, f"read failed: {result.error}"
    content = result.file_data["content"]

    assert "# Data extract" in content, (
        f"Expected '# Data extract' heading in skill body, got start: {content[:200]!r}"
    )
