"""Tests for the data-extract SKILL.md (Phase 1.4.x-T5).

Workflow skill for cell-level paper extraction. Uses read_paper (T3) +
csv_read/csv_write_cell (T4). No subagents, no approvals — single-shot
cell fill.
"""
from skills import SKILLS_ROOT, load_skills
from tools import ALL_TOOLS


def test_data_extract_skill_loads():
    [s] = load_skills(only=["data-extract"])
    assert s.name == "data-extract"
    assert s.path == SKILLS_ROOT / "data-extract" / "SKILL.md"


def test_data_extract_tools_allowlist():
    [s] = load_skills(only=["data-extract"])
    assert s.tools == ["read_paper", "csv_read", "csv_write_cell"]


def test_data_extract_no_subagents():
    [s] = load_skills(only=["data-extract"])
    assert s.subagents == []


def test_data_extract_no_approvals():
    [s] = load_skills(only=["data-extract"])
    assert s.require_approval == []


def test_data_extract_tools_exist_in_registry():
    [s] = load_skills(only=["data-extract"])
    registered = {t.name for t in ALL_TOOLS}
    for tool_name in s.tools:
        assert tool_name in registered, f"{tool_name} missing from ALL_TOOLS"


def test_data_extract_body_contains_scope_rules():
    [s] = load_skills(only=["data-extract"])
    body = s.body()
    # Five scope kinds, in priority order.
    assert 'kind="sections"' in body
    assert 'kind="blocks"' in body
    assert 'kind="pages"' in body
    assert 'kind="rag"' in body
    assert 'kind="full"' in body
    # Unanswered cells.
    assert "n/a" in body
    # Token budget.
    assert "Budget: 5k tokens" in body
