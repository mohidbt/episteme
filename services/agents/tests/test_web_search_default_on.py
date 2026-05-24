"""K12 — web_search permission default-ON semantics.

The gate flips: a missing key (or None) means the tool is bound.
Only an explicit `False` filters it out.
"""
from pathlib import Path

from langchain_core.tools import BaseTool

from km_agent import (
    _CORE_TOOL_NAMES,
    _filter_tools_for_permissions,
    _filter_tools_for_skills,
)
from skills import SkillSpec
from tools import ALL_TOOLS


def _has_web_search(tools: list[BaseTool]) -> bool:
    return any(t.name == "web_search" for t in tools)


def test_web_search_default_on_when_permissions_missing():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {})
    assert _has_web_search(filtered)


def test_web_search_default_on_when_permissions_none():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), None)
    assert _has_web_search(filtered)


def test_web_search_default_on_when_key_missing_but_other_keys_present():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"other_key": True})
    assert _has_web_search(filtered)


def test_web_search_explicit_true_kept():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"web_search": True})
    assert _has_web_search(filtered)


def test_web_search_explicit_false_filtered_out():
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"web_search": False})
    assert not _has_web_search(filtered)


def test_web_search_none_value_treated_as_on():
    """`null` in settings_json JSON column — treat as undefined → ON."""
    filtered = _filter_tools_for_permissions(list(ALL_TOOLS), {"web_search": None})
    assert _has_web_search(filtered)


# ------- K12 bug: skill-filter was stripping web_search before perm filter ran.
# Root cause: web_search was NOT in _CORE_TOOL_NAMES and no SKILL.md frontmatter
# lists it under `tools:`, so `_filter_tools_for_skills` dropped it whenever
# any skill was enabled — making the K12 v1 permission toggle decorative in
# prod (the test account has 4 skills enabled by default).


def test_web_search_is_core():
    """web_search must live in CORE so skill-filter never strips it.

    Conceptually it sits alongside other "always-bound, permission-gated"
    tools — the permission filter is the SINGLE source of truth for whether
    web_search is bound, not skill frontmatter authorship.
    """
    assert "web_search" in _CORE_TOOL_NAMES


def test_web_search_survives_skill_filter_with_enabled_skills():
    """With ANY skill enabled, skill-filter must NOT drop web_search.

    Reproduces the live prod bug: enabled_skills={lit-triage} (a skill whose
    SKILL.md does not list web_search in tools frontmatter) → web_search
    was stripped, and the model replied "there is no web_search tool".
    """
    skill = SkillSpec(
        name="lit-triage",
        description="fixture mirroring real lit-triage (no web_search in tools)",
        tools=["find_papers", "read_paper"],
        subagents=[],
        require_approval=[],
        path=Path("/dev/null"),
    )
    filtered = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=[skill])
    assert _has_web_search(filtered)


def test_web_search_default_on_end_to_end_through_both_filters():
    """Skill-filter → permission-filter pipeline preserves web_search by default."""
    skill = SkillSpec(
        name="lit-triage",
        description="fixture",
        tools=["find_papers"],
        subagents=[],
        require_approval=[],
        path=Path("/dev/null"),
    )
    after_skills = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=[skill])
    after_perms = _filter_tools_for_permissions(after_skills, permissions={})
    assert _has_web_search(after_perms)


def test_web_search_opt_out_still_works_with_skills_enabled():
    """Permission=False is honored even when skills are enabled."""
    skill = SkillSpec(
        name="lit-triage",
        description="fixture",
        tools=["find_papers"],
        subagents=[],
        require_approval=[],
        path=Path("/dev/null"),
    )
    after_skills = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=[skill])
    after_perms = _filter_tools_for_permissions(
        after_skills, permissions={"web_search": False}
    )
    assert not _has_web_search(after_perms)
