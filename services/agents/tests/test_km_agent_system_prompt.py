"""Tests for canonical SkillsMiddleware integration in build_km_agent.

RED → GREEN: after enabling skills=["/.episteme/agents/skills/"] in km_agent.py and
deleting the hand-rolled bullets block.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


def _make_data_extract_spec():
    """Build a minimal SkillSpec for data-extract from disk."""
    from skills import load_skills  # noqa: PLC0415
    return load_skills(only=["data-extract"])


async def _build_capturing(enabled_skills: list[str], loaded_specs=None) -> dict:
    """Call build_km_agent with captured create_deep_agent kwargs.

    DriveSkillsLoader is mocked so no network call is needed.
    """
    from km_agent import build_km_agent  # noqa: PLC0415

    captured: dict = {}
    fake_graph = MagicMock()

    def _capture_create(**kwargs):
        captured.update(kwargs)
        return fake_graph

    # Return pre-loaded disk specs so the real filter / interrupt logic runs.
    mock_specs = loaded_specs if loaded_specs is not None else _make_data_extract_spec()

    with (
        patch("km_agent.create_deep_agent", side_effect=_capture_create),
        patch("km_agent.DriveSkillsLoader") as MockLoader,
        patch("km_agent._fetch_personal_skills", new=AsyncMock(return_value=[])),
    ):
        instance = MockLoader.return_value
        instance.load = AsyncMock(return_value=mock_specs)
        await build_km_agent(
            user_id="u1",
            thread_id="t1",
            model="claude-sonnet-4-5-20250929",
            enabled_skills=enabled_skills,
            approval_rules={},
            store=InMemoryStore(),
            saver=MemorySaver(),
        )

    return captured


@pytest.mark.asyncio
async def test_skills_section_advertises_reachable_path():
    """After GREEN: create_deep_agent is called with skills=[SKILLS_ROOT].

    The canonical SkillsMiddleware then advertises each skill's path in the
    format  -> Read `/.episteme/agents/skills/<name>/SKILL.md` for full
    instructions, and the template instructs the model to use read_file with
    limit=1000.
    """
    captured = await _build_capturing(enabled_skills=["data-extract"])

    # GREEN assertion: skills list must be passed (not None)
    assert captured.get("skills") is not None, (
        "create_deep_agent was called with skills=None — SkillsMiddleware not enabled"
    )
    assert "/.episteme/agents/skills/" in captured["skills"], (
        f"Expected '/.episteme/agents/skills/' in skills sources, got: {captured['skills']}"
    )

    # Verify the SKILLS_SYSTEM_PROMPT template (canonical) instructs read_file with limit=1000.
    from deepagents.middleware.skills import SKILLS_SYSTEM_PROMPT  # noqa: PLC0415

    assert "read_file" in SKILLS_SYSTEM_PROMPT
    assert "limit=1000" in SKILLS_SYSTEM_PROMPT

    # Verify SkillsMiddleware formats data-extract's path correctly.
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415
    from deepagents.middleware.skills import SkillsMiddleware, _list_skills  # noqa: PLC0415

    backend = SkillsBackend()
    skills = _list_skills(backend, "/.episteme/agents/skills/")
    skill_names = {s["name"] for s in skills}
    assert "data-extract" in skill_names, f"data-extract not found in {skill_names}"

    de = next(s for s in skills if s["name"] == "data-extract")
    assert de["description"], "data-extract must have a description"
    assert de["path"] == "/.episteme/agents/skills/data-extract/SKILL.md"

    mw = SkillsMiddleware(backend=backend, sources=["/.episteme/agents/skills/"])
    formatted = mw._format_skills_list(skills)
    assert "data-extract" in formatted
    assert "/.episteme/agents/skills/data-extract/SKILL.md" in formatted
    assert "Read `/.episteme/agents/skills/data-extract/SKILL.md` for full instructions" in formatted


@pytest.mark.asyncio
async def test_hand_rolled_bullets_block_removed():
    """After GREEN: system_prompt passed to create_deep_agent must NOT contain
    the hand-rolled '## Skills (workflows you execute INLINE)' marker.

    Before GREEN (RED): build_km_agent appends the hand-rolled block when
    enabled_skills is non-empty.
    """
    captured = await _build_capturing(enabled_skills=["data-extract"])
    system_prompt = captured.get("system_prompt", "")

    assert "## Skills (workflows you execute INLINE)" not in system_prompt, (
        "Hand-rolled bullets block still present in system_prompt — "
        "delete lines 363-382 in km_agent.py"
    )


@pytest.mark.asyncio
async def test_read_file_can_fetch_skill_body():
    """The SkillsBackend can serve the data-extract skill body via the virtual path.

    Regression lock: the agent's read_file tool uses this backend. If this path
    breaks, the model cannot read the skill's full instructions on demand.
    """
    from backends.skills_backend import SkillsBackend  # noqa: PLC0415

    backend = SkillsBackend()
    result = await backend.aread("/.episteme/agents/skills/data-extract/SKILL.md")

    assert result.error is None, f"read failed: {result.error}"
    content = result.file_data["content"]

    # First heading of the data-extract SKILL.md body
    assert "# Data extract" in content, (
        f"Expected '# Data extract' heading in skill body, got start: {content[:200]!r}"
    )
