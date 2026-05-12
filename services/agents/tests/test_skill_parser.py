"""TDD tests for spec-aligned SKILL.md frontmatter parser (Phase 1.9e T3).

Four RED tests:
  1. Canonical `allowed-tools` (space-delimited) → SkillSpec.tools
  2. `metadata.subagents` / `metadata.require_approval` → SkillSpec fields
  3. Body field populated and excludes frontmatter delimiters
  4. Legacy top-level `tools:` array still parses (with deprecation warning)
"""
import warnings
from pathlib import Path

import pytest


_VIRTUAL_PATH = Path("/virtual/test-skill/SKILL.md")


def _parse(text: str):
    from skills import _parse_skill_md_text  # noqa: PLC0415
    return _parse_skill_md_text(text, _VIRTUAL_PATH)


# ---------------------------------------------------------------------------
# 1. Canonical allowed-tools
# ---------------------------------------------------------------------------

CANONICAL_ALLOWED_TOOLS = """\
---
name: data-extract
description: Extract structured values from a paper into a CSV cell. One cell at a time.
allowed-tools: read_paper csv_read csv_write_cell
metadata:
  subagents: []
  require_approval: []
---

# Data extract

Body content here.
"""


def test_parses_canonical_allowed_tools():
    spec = _parse(CANONICAL_ALLOWED_TOOLS)
    assert spec is not None
    assert spec.tools == ["read_paper", "csv_read", "csv_write_cell"]


# ---------------------------------------------------------------------------
# 2. metadata.subagents / metadata.require_approval
# ---------------------------------------------------------------------------

CANONICAL_METADATA = """\
---
name: claim-verify
description: Verify claims against sources.
allowed-tools: read_note update_note
metadata:
  subagents: [verifier]
  require_approval: [update_note]
---

# Claim verify

Body here.
"""


def test_parses_metadata_subagents():
    spec = _parse(CANONICAL_METADATA)
    assert spec is not None
    assert spec.subagents == ["verifier"]
    assert spec.require_approval == ["update_note"]


# ---------------------------------------------------------------------------
# 3. Body field populated, excludes frontmatter delimiters
# ---------------------------------------------------------------------------

BODY_TEST = """\
---
name: data-extract
description: Extract structured values from a paper.
allowed-tools: read_paper csv_read
metadata:
  subagents: []
  require_approval: []
---

# Data extract

Some body content.
"""


def test_populates_body_field():
    spec = _parse(BODY_TEST)
    assert spec is not None
    # body() must return non-empty string
    body = spec.body()
    assert len(body) > 0
    # Body must not start with a frontmatter delimiter line
    assert not body.startswith("---\n")
    # The canonical `name:` frontmatter line must not appear in the body
    assert "name: data-extract" not in body
    # Must start with the first heading (after optional blank line)
    assert "# Data extract" in body


# ---------------------------------------------------------------------------
# 4. Legacy top-level keys still parse (with deprecation warning)
# ---------------------------------------------------------------------------

LEGACY_FRONTMATTER = """\
---
name: lit-triage
description: Triage daily literature.
tools: [search_notes, create_note]
subagents: [researcher]
require_approval: [create_note]
---

# Lit Triage

Legacy body.
"""


def test_legacy_top_level_keys_still_parse():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        spec = _parse(LEGACY_FRONTMATTER)

    assert spec is not None
    assert spec.tools == ["search_notes", "create_note"]
    assert spec.subagents == ["researcher"]
    assert spec.require_approval == ["create_note"]

    # Must emit a DeprecationWarning for legacy form
    dep_warnings = [w for w in caught if issubclass(w.category, DeprecationWarning)]
    assert dep_warnings, "Expected at least one DeprecationWarning for legacy frontmatter"


# ---------------------------------------------------------------------------
# 5. metadata must be a dict — non-dict raises ValueError with skill name
# ---------------------------------------------------------------------------

METADATA_NON_DICT = """\
---
name: bad-skill
description: Skill with non-dict metadata.
allowed-tools: read_paper
metadata: ["a", "b"]
---

# Bad skill
"""


def test_metadata_non_dict_raises():
    with pytest.raises(ValueError) as exc_info:
        _parse(METADATA_NON_DICT)
    assert "bad-skill" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 6. Top-level legacy `subagents` warns even when `allowed-tools` is used
# ---------------------------------------------------------------------------

CANONICAL_TOOLS_WITH_LEGACY_SUBAGENTS = """\
---
name: mixed-skill
description: Skill mixing canonical tools with legacy top-level subagents.
allowed-tools: read_paper
subagents: [x]
---

# Mixed skill
"""


def test_legacy_subagents_top_level_warns():
    with pytest.warns(DeprecationWarning, match="mixed-skill"):
        _parse(CANONICAL_TOOLS_WITH_LEGACY_SUBAGENTS)
