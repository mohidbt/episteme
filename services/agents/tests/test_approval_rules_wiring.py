"""GSD-68 — approval_rules wiring tests.

Two contracts:
1. `_build_interrupt_on` applies per-tool defaults from `_DEFAULT_APPROVAL_RULES`
   when the user has no explicit rule for that tool.
2. An arbitrary user-supplied tool rule ("require" / "auto") overrides
   metadata and defaults — proves the wire path from KM → agent works for
   any tool, not just the legacy four (publish/external_send/write_note/highlight).
"""
import pytest

from km_agent import _DEFAULT_APPROVAL_RULES, _build_interrupt_on


def test_destructive_tools_default_to_require():
    """Without any user rule, destructive tools must default to HITL require."""
    interrupt_on = _build_interrupt_on({})
    for tool in (
        "delete_paper",
        "delete_folder",
        "delete_user_highlight",
        "extract_paper_citations",
        "enrich_paper_citations",
        "save_paper_citation_to_library",
        "paperset_enrich",
        "agentic_fetch_papers",
        "make_public",
    ):
        assert interrupt_on.get(tool) is True, f"{tool} should default to require"


def test_non_destructive_tools_default_to_auto():
    """Read-only / cheap tools must not interrupt by default."""
    interrupt_on = _build_interrupt_on({})
    for tool in (
        "list_notes",
        "search_notes",
        "list_revisions",
        "list_paper_citations",
        "list_user_highlights",
        "csv_read",
    ):
        # Either absent or False — both mean no interrupt.
        assert not interrupt_on.get(tool), f"{tool} should default to auto"


def test_user_override_to_auto_wins_against_default():
    """If user explicitly toggles a destructive tool to auto, default loses."""
    interrupt_on = _build_interrupt_on({"make_public": "auto"})
    assert interrupt_on.get("make_public") is False


def test_user_require_on_arbitrary_tool_takes_effect():
    """Wire path: KM body → approval_rules={"browse_papersets": "require"} →
    `browse_papersets` interrupts. Proves the dict is not action-name-keyed
    only (the legacy `publish`/`external_send`/`write_note` aliases) but
    accepts arbitrary tool names.
    """
    interrupt_on = _build_interrupt_on({"browse_papersets": "require"})
    assert interrupt_on.get("browse_papersets") is True


def test_default_approval_map_keys_are_real_tools():
    """Every key in _DEFAULT_APPROVAL_RULES must be a tool that actually
    exists — otherwise a typo silently disables the gate."""
    from tools import ALL_TOOLS  # noqa: PLC0415

    real = {t.name for t in ALL_TOOLS}
    unknown = sorted(set(_DEFAULT_APPROVAL_RULES) - real)
    assert not unknown, f"_DEFAULT_APPROVAL_RULES references unknown tools: {unknown}"


@pytest.mark.asyncio
async def test_tools_route_exposes_default_approval():
    """UI source of truth for default approval mode comes from /agents/km/tools."""
    from routers.km_agent import list_tools  # noqa: PLC0415

    resp = await list_tools({"user_id": "u1", "llm_key": "test"})
    by_name = {t["name"]: t for t in resp["tools"]}
    assert by_name["delete_paper"]["default_approval"] == "require"
    assert by_name["list_notes"]["default_approval"] == "auto"
    assert by_name["make_public"]["default_approval"] == "require"
