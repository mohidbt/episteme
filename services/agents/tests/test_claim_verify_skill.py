"""Tests for the claim-verify SKILL.md (Phase 1.4-T1).

Frontmatter ships without `extract_passages` (stubbed; excluded from ALL_TOOLS).
The verifier subagent does its own evidence search via search_notes +
list_references; phase 1.5.1 will revive direct passage extraction.
"""
from skills import SKILLS_ROOT, load_skills


def test_claim_verify_skill_loads():
    [s] = load_skills(only=["claim-verify"])
    assert s.name == "claim-verify"
    assert s.path == SKILLS_ROOT / "claim-verify" / "SKILL.md"


def test_claim_verify_description_mentions_claims():
    [s] = load_skills(only=["claim-verify"])
    assert "claim" in s.description.lower()


def test_claim_verify_tools_allowlist():
    [s] = load_skills(only=["claim-verify"])
    # extract_passages intentionally omitted — stubbed tool, see plan tech debt.
    assert s.tools == ["read_note", "update_note", "list_references"]


def test_claim_verify_uses_verifier_subagent():
    [s] = load_skills(only=["claim-verify"])
    assert s.subagents == ["verifier"]


def test_claim_verify_requires_approval_on_update_note():
    [s] = load_skills(only=["claim-verify"])
    assert "update_note" in s.require_approval


def test_claim_verify_body_describes_workflow():
    [s] = load_skills(only=["claim-verify"])
    body = s.body()
    assert "read_note" in body
    assert "verifier" in body
    assert "update_note" in body
    # Inline flag for unsupported claims.
    assert "unsupported" in body.lower()
