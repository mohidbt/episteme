"""CI-blocking invariants over the tool inventory (GSD-70).

These tests catch silent UI ↔ runtime drift: any new tool added to
`ALL_TOOLS` must be either CORE or advertised by a skill, and must have a
category mapping, otherwise it disappears from the agent the moment a
logged-in user turns on any skill.

No live KM dependency — pure module-level introspection so the test runs in
CI without docker / network.
"""
from __future__ import annotations

import pytest

from skills import SKILLS_ROOT, _parse_skill_md  # type: ignore[attr-defined]
from tools import ALL_TOOLS


def _collect_skill_tool_names() -> set[str]:
    """Union of every disk SKILL.md's allowed-tools list."""
    names: set[str] = set()
    for skill_md in SKILLS_ROOT.glob("*/SKILL.md"):
        try:
            spec = _parse_skill_md(skill_md)
        except ValueError:
            continue
        if spec is None:
            continue
        names.update(spec.tools)
    return names


def test_every_tool_is_core_or_advertised_by_a_skill():
    """Each ALL_TOOLS entry must survive `_filter_tools_for_skills`.

    A tool that is neither CORE nor listed in some skill's allowed-tools
    is silently dropped the moment a logged-in user enables any skill —
    this is the GSD-70 root-cause class.
    """
    from km_agent import _CORE_TOOL_NAMES  # noqa: PLC0415

    skill_tools = _collect_skill_tool_names()
    reachable = set(_CORE_TOOL_NAMES) | skill_tools
    orphans = sorted({t.name for t in ALL_TOOLS} - reachable)
    assert not orphans, (
        f"{len(orphans)} tool(s) are in ALL_TOOLS but not reachable when any "
        f"skill is enabled (neither CORE nor advertised by any SKILL.md "
        f"allowed-tools): {orphans}"
    )


def test_category_map_covers_every_tool():
    """No `other` fallback for shipped tools — UI groups by category."""
    from routers.km_agent import _CATEGORY_MAP  # noqa: PLC0415

    missing = sorted({t.name for t in ALL_TOOLS} - set(_CATEGORY_MAP))
    assert not missing, (
        f"{len(missing)} tool(s) have no _CATEGORY_MAP entry (will fall to "
        f"'other' bucket in PermissionToggles UI): {missing}"
    )


@pytest.mark.asyncio
async def test_tools_route_returns_every_tool():
    """`/agents/km/tools` returns exactly the set of names in ALL_TOOLS.

    Asserted by calling `list_tools` directly with a fake authed dep — no
    HTTP layer needed.
    """
    from routers.km_agent import list_tools  # noqa: PLC0415

    fake_auth = {"user_id": "u1", "llm_key": "test"}
    resp = await list_tools(fake_auth)
    served_names = {t["name"] for t in resp["tools"]}
    expected = {t.name for t in ALL_TOOLS}
    assert served_names == expected, (
        f"drift: served-but-not-in-ALL_TOOLS="
        f"{sorted(served_names - expected)} "
        f"in-ALL_TOOLS-but-not-served={sorted(expected - served_names)}"
    )


@pytest.mark.parametrize(
    "orphan_name",
    [
        "list_user_highlights",
        "delete_user_highlight",
        "fill_reference",
        "resolve_doi",
        "paperset_enrich",
        "pdf_read_tables",
        "diff_revision",
        "list_revisions",
        "move_paper",
        "rename_paper",
        "delete_paper",
        "create_folder",
        "move_folder",
        "rename_folder",
        "delete_folder",
        "list_paper_citations",
        "list_paper_citation_edges",
        "list_paper_citation_markers",
        "extract_paper_citations",
        "enrich_paper_citations",
        "rematch_paper_citations",
        "keep_paper_citation",
        "save_paper_citation_to_library",
    ],
)
def test_gsd70_orphan_is_in_core(orphan_name: str):
    """Explicit roll-call: every GSD-70 orphan tool lands in CORE."""
    from km_agent import _CORE_TOOL_NAMES  # noqa: PLC0415

    assert orphan_name in _CORE_TOOL_NAMES, (
        f"{orphan_name!r} must be in _CORE_TOOL_NAMES (GSD-70)"
    )


@pytest.mark.asyncio
async def test_drive_ops_tools_in_served_inventory():
    """GSD-88 — every drive_ops tool (move/rename/delete papers+folders, create_folder)
    appears in the /agents/km/tools response. Catches regressions where a new
    drive_ops tool is added to drive_ops.py but the module isn't wired into
    ALL_TOOLS or the _CATEGORY_MAP, leaving the UI permission toggle invisible.
    """
    from routers.km_agent import list_tools  # noqa: PLC0415

    fake_auth = {"user_id": "u1", "llm_key": "test"}
    resp = await list_tools(fake_auth)
    served = {t["name"] for t in resp["tools"]}
    drive_ops_expected = {
        "move_paper", "rename_paper", "delete_paper",
        "create_folder", "move_folder", "rename_folder", "delete_folder",
    }
    missing = drive_ops_expected - served
    assert not missing, f"drive_ops tools missing from /tools response: {sorted(missing)}"
