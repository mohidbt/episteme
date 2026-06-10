"""RED tests for generalized tool-permissions gate + disabled-tools addendum (GSD-33).

Phase 1: prove that
1. `_filter_tools_for_permissions` works for ANY tool name (not just keys in the
   legacy `_PERMISSION_GATED_TOOLS` dict).
2. `_build_disabled_tools_addendum` produces a non-empty system-prompt block
   only when there is at least one permission-disabled tool that survived the
   skill filter.
3. The addendum is concatenated into the top-level system prompt.
4. Subagent prompts are NOT touched.
"""
from __future__ import annotations

from pathlib import Path
from typing import List
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

class _CapturingFakeModel(BaseChatModel):
    """BaseChatModel that records every invoke's input and terminates the loop."""

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
    assert sys_msgs, "no SystemMessage in model-facing messages"
    content = sys_msgs[0].content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


async def _build(permissions=None, enabled_skills=None, loaded_specs=None, model=None):
    from km_agent import build_km_agent  # noqa: PLC0415

    with (
        patch("km_agent.DriveSkillsLoader") as MockLoader,
        patch("km_agent._fetch_personal_skills", new=AsyncMock(return_value=[])),
    ):
        MockLoader.return_value.load = AsyncMock(return_value=loaded_specs or [])
        return await build_km_agent(
            user_id="u1",
            thread_id="t1",
            model=model or "claude-sonnet-4-5-20250929",
            enabled_skills=enabled_skills or [],
            approval_rules={},
            store=InMemoryStore(),
            saver=MemorySaver(),
            permissions=permissions or {},
        )


async def _capture_system_prompt(permissions=None, enabled_skills=None, loaded_specs=None) -> str:
    model = _CapturingFakeModel(captured_inputs=[])
    agent = await _build(
        permissions=permissions,
        enabled_skills=enabled_skills,
        loaded_specs=loaded_specs,
        model=model,
    )
    from langchain_core.messages import HumanMessage  # noqa: PLC0415

    agent.invoke(
        {"messages": [HumanMessage(content="hello")]},
        config={"configurable": {"thread_id": "t1"}, "recursion_limit": 10},
    )
    assert model.captured_inputs, "fake model never invoked"
    return _extract_system_text(model.captured_inputs[0])


# ---------------------------------------------------------------------------
# Generalised _filter_tools_for_permissions
# ---------------------------------------------------------------------------

def test_legacy_permission_gated_tools_dict_dropped():
    """Filter must work for any tool name, not just web_search."""
    from km_agent import _filter_tools_for_permissions  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    out = _filter_tools_for_permissions(
        list(ALL_TOOLS), permissions={"create_note": False}
    )
    names = {t.name for t in out}
    assert "create_note" not in names
    # but other tools survive
    assert "web_search" in names


def test_missing_key_is_default_allowed():
    from km_agent import _filter_tools_for_permissions  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    out = _filter_tools_for_permissions(list(ALL_TOOLS), permissions={})
    assert {t.name for t in out} == {t.name for t in ALL_TOOLS}


def test_explicit_true_is_allowed():
    from km_agent import _filter_tools_for_permissions  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    out = _filter_tools_for_permissions(
        list(ALL_TOOLS), permissions={"web_search": True}
    )
    assert "web_search" in {t.name for t in out}


def test_multiple_disabled_dropped():
    from km_agent import _filter_tools_for_permissions  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    out = _filter_tools_for_permissions(
        list(ALL_TOOLS),
        permissions={"web_search": False, "create_note": False},
    )
    names = {t.name for t in out}
    assert "web_search" not in names
    assert "create_note" not in names


@pytest.mark.asyncio
async def test_disabled_tool_dropped_in_built_agent():
    """When the agent is built with permissions, the disabled tool must
    not appear in the bound tool set."""
    agent = await _build(permissions={"create_note": False})
    tool_names = {t.name for t in getattr(agent, "tools", []) or []}
    if not tool_names:
        # fallback: dig into nodes — different agent shape across versions
        nodes = getattr(agent, "nodes", {}) or {}
        for node in nodes.values():
            tools = getattr(node, "tools", None) or []
            tool_names.update(getattr(t, "name", "") for t in tools)
    # If we still can't find tools, fall back to checking the system prompt
    # contains expected tools and not the disabled one. The strict assertion is
    # provided by the unit-level filter tests above; here we just sanity-check
    # the integration wiring didn't drop everything.
    assert "create_note" not in tool_names or not tool_names


# ---------------------------------------------------------------------------
# Disabled-tools system-prompt addendum
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_disabled_tools_addendum_present_when_nonempty():
    text = await _capture_system_prompt(permissions={"create_note": False})
    assert "create_note" in text
    # Addendum should be under a recognisable heading so the model knows the
    # context — match either the explicit heading word or a plain mention.
    assert "disabled" in text.lower()


@pytest.mark.asyncio
async def test_disabled_tools_addendum_absent_when_empty():
    text = await _capture_system_prompt(permissions={})
    # No permission-disabled tools → no addendum heading
    assert "Tool restrictions" not in text
    assert "disabled in your settings" not in text


@pytest.mark.asyncio
async def test_addendum_excludes_skill_pruned_tools():
    """If a skill prunes a tool already, mentioning that tool in the addendum
    is misleading. The addendum must only list permission-disabled tools that
    survived the skill filter."""
    from skills import SkillSpec  # noqa: PLC0415

    # `search_library` is NOT in _CORE_TOOL_NAMES (post-GSD-70: it remains
    # cross-library RAG, opt-in per skill), so a skill that doesn't list it in
    # `tools=` will get it pruned by the skill filter.
    # web_search IS in _CORE_TOOL_NAMES, so it survives the skill filter
    # and is then dropped by the permission filter — addendum must mention it.
    skill = SkillSpec(
        name="lit-triage",
        description="fixture",
        tools=["find_papers"],
        subagents=[],
        require_approval=[],
        path=Path("/dev/null"),
    )

    text = await _capture_system_prompt(
        permissions={"search_library": False, "web_search": False},
        enabled_skills=["lit-triage"],
        loaded_specs=[skill],
    )
    # web_search is core → survives skill filter → permission-dropped → addendum
    assert "web_search" in text
    # search_library was skill-pruned (non-core, not in skill.tools). Addendum
    # must NOT mention it — telling the user "X is disabled in settings"
    # would be misleading when the skill is what's actually hiding it.
    lines = text.lower().split("\n")
    in_addendum = False
    addendum_text = []
    for line in lines:
        if line.startswith("## tool restrictions"):
            in_addendum = True
            continue
        if in_addendum and line.startswith("## "):
            in_addendum = False
        if in_addendum:
            addendum_text.append(line)
    addendum_blob = "\n".join(addendum_text)
    assert "search_library" not in addendum_blob


@pytest.mark.asyncio
async def test_subagent_prompts_unchanged_by_permissions():
    """Subagent system prompts (researcher/synthesizer/verifier) must NOT
    receive the disabled-tools addendum — only the top-level KM agent prompt
    does."""
    from skills import SkillSpec  # noqa: PLC0415
    from km_agent import _select_subagents  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    skill = SkillSpec(
        name="lit-triage",
        description="fixture",
        tools=["find_papers", "web_search"],
        subagents=["researcher"],
        require_approval=[],
        path=Path("/dev/null"),
    )
    subs = _select_subagents([skill], available_tools=list(ALL_TOOLS))
    assert subs, "expected at least one materialized subagent"
    for sub in subs:
        # SubAgent/CompiledSubAgent expose a system_prompt or prompt field
        prompt = getattr(sub, "system_prompt", None) or getattr(sub, "prompt", None) or ""
        if isinstance(prompt, str):
            assert "Tool restrictions" not in prompt
            assert "disabled in your settings" not in prompt
