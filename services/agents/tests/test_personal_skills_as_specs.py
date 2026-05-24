"""K4: personal skills are first-class deepagents SkillSpecs.

Personal skills (user-authored, from /api/agents/skills/personal) should NOT
be concatenated unconditionally into the system prompt. They should be
advertised by SkillsMiddleware (name + description only) and have their
instructions loaded on-demand via the skills backend.
"""
from __future__ import annotations

from typing import List
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore

SKILLS_ROOT = "/.episteme/agents/skills/"

_PERSONAL = [
    {
        "slug": "rasta",
        "name": "rasta",
        "description": "rasta style",
        "instructions": "ya mon",
    }
]


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
    from langchain_core.messages import SystemMessage  # noqa: PLC0415

    sys_msgs = [m for m in messages if isinstance(m, SystemMessage)]
    assert sys_msgs, "no SystemMessage"
    content = sys_msgs[0].content
    if isinstance(content, list):
        return " ".join(
            b.get("text", "") if isinstance(b, dict) else str(b) for b in content
        )
    return str(content)


async def _build_and_capture_system(enabled_skills: list[str]) -> str:
    """Build agent with personal skills mocked, return model-facing system text."""
    from km_agent import build_km_agent  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    mock_specs = load_skills(only=["data-extract"]) if enabled_skills else []
    model = _CapturingFakeModel(captured_inputs=[])

    with (
        patch("km_agent.DriveSkillsLoader") as MockLoader,
        patch("km_agent._fetch_personal_skills", new=AsyncMock(return_value=_PERSONAL)),
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

    agent.invoke(
        {"messages": [HumanMessage(content="hello")]},
        config={"configurable": {"thread_id": "t1"}, "recursion_limit": 10},
    )
    assert model.captured_inputs
    return _extract_system_text(model.captured_inputs[0])


@pytest.mark.asyncio
async def test_personal_skill_advertised_by_skills_middleware():
    """Personal skill name and description must appear in the SkillsMiddleware
    section so the model knows it exists."""
    system_text = await _build_and_capture_system(enabled_skills=["data-extract"])

    # SkillsMiddleware-rendered block
    marker = "## Skills System"
    idx = system_text.find(marker)
    assert idx != -1, "Skills System section missing"
    skills_section = system_text[idx:]

    assert "rasta" in skills_section, (
        "personal skill 'rasta' not advertised by SkillsMiddleware"
    )
    assert "rasta style" in skills_section, (
        "personal skill description not advertised by SkillsMiddleware"
    )


@pytest.mark.asyncio
async def test_personal_skill_instructions_not_unconditionally_injected():
    """The full instructions body ('ya mon') must NOT appear in the system
    prompt unconditionally. Only the description-level advertisement should
    appear — instructions load on-demand via read_file."""
    system_text = await _build_and_capture_system(enabled_skills=["data-extract"])

    assert "ya mon" not in system_text, (
        "personal skill instructions leaked into unconditional system prompt — "
        "should only be advertised by description, loaded on-demand"
    )
    # The legacy hand-rolled section header must also be gone.
    assert "## Personal Skills (user-authored)" not in system_text, (
        "legacy '## Personal Skills (user-authored)' header still in system prompt"
    )


@pytest.mark.asyncio
async def test_personal_skill_body_loadable_via_backend():
    """The SkillsBackend, when seeded with personal skills, must serve the
    SKILL.md body for the personal skill at the virtual path. This is what
    SkillsMiddleware's read_file uses to deliver the on-demand instructions."""
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415

    backend = SkillsBackend(personal_skills=_PERSONAL)
    result = await backend.aread(f"{SKILLS_ROOT}rasta/SKILL.md")

    assert result.error is None, f"read failed: {result.error}"
    body = result.file_data["content"]
    assert "ya mon" in body, (
        f"personal skill body missing instructions; got: {body[:200]!r}"
    )


@pytest.mark.asyncio
async def test_personal_skills_bypass_enabled_allowlist():
    """Personal skills are always-on for that user; disk-skill allowlist gating
    (enabled_skills frozenset) does NOT apply to them. Confirms intentional
    bypass at skills_backend.py:70.

    Asserts BOTH:
      1. A disk skill NOT in enabled_skills is hidden (allowlist works for disk).
      2. A personal skill NOT in enabled_skills IS visible (bypass intentional).
    """
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415

    # Disk skill name guaranteed to exist on-disk under services/agents/skills/.
    # Use one not in the allowlist below to prove disk allowlist gating works.
    from pathlib import Path  # noqa: PLC0415

    disk_root = (
        Path(__file__).resolve().parent.parent / "skills"
    )
    disk_skill_names = sorted(
        p.name for p in disk_root.iterdir()
        if p.is_dir() and not p.name.startswith("_")
    )
    assert disk_skill_names, "no on-disk skills found for test setup"
    excluded_disk_skill = disk_skill_names[0]
    # Allowlist contains only a synthetic name — guarantees excluded_disk_skill
    # is NOT in the allowlist.
    enabled = frozenset({"__never_matches__"})

    backend = SkillsBackend(enabled=enabled, personal_skills=_PERSONAL)

    # ls() — disk skill not in allowlist must be hidden; personal skill must appear.
    ls_result = await backend.als(SKILLS_ROOT.rstrip("/"))
    paths = [e["path"] for e in (ls_result.entries or [])]
    flat = " ".join(paths)

    assert "rasta" in flat, (
        f"personal skill 'rasta' missing from ls despite not in enabled={enabled!r}: "
        f"{paths!r}"
    )
    assert excluded_disk_skill not in flat, (
        f"disk skill {excluded_disk_skill!r} leaked into ls despite allowlist "
        f"excluding it: {paths!r}"
    )

    # read() — personal SKILL.md served even though slug not in enabled allowlist.
    read_result = await backend.aread(f"{SKILLS_ROOT}rasta/SKILL.md")
    assert read_result.error is None, (
        f"personal SKILL.md read failed despite allowlist bypass: {read_result.error}"
    )
    assert "ya mon" in read_result.file_data["content"]


@pytest.mark.asyncio
async def test_personal_skill_listed_by_backend_ls():
    """SkillsBackend.als at the skills root must include the personal skill
    subdir — this is what SkillsMiddleware enumerates to build its advertisement."""
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415

    backend = SkillsBackend(
        enabled=frozenset(),  # no disk skills enabled
        personal_skills=_PERSONAL,
    )
    result = await backend.als(SKILLS_ROOT.rstrip("/"))
    paths = [e["path"] for e in (result.entries or [])]
    assert any("rasta" in p for p in paths), (
        f"personal skill subdir not in ls entries: {paths!r}"
    )
