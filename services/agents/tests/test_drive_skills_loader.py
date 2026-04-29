"""Tests for the Phase 1.3f DriveSkillsLoader (skills served from drive notes)."""
from pathlib import Path

import pytest


def test_parse_skill_md_text_works_with_in_memory_string():
    """Parser must accept a raw string (note.contentMd over HTTP) — not just a Path."""
    from skills import _parse_skill_md_text  # noqa: PLC0415

    text = """---
name: lit-triage
description: Score and bucket literature.
tools: [list_notes, search_notes]
subagents: [researcher]
require_approval: []
---

# Lit Triage Body
"""
    spec = _parse_skill_md_text(text, Path("/virtual/lit-triage/SKILL.md"))
    assert spec is not None
    assert spec.name == "lit-triage"
    assert spec.tools == ["list_notes", "search_notes"]
