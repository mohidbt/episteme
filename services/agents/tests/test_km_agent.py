"""RED tests for km_agent factory."""
import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


async def _build(approval_rules=None, **kwargs):
    """Helper — build with sensible test defaults."""
    from km_agent import build_km_agent  # noqa: PLC0415

    return await build_km_agent(
        user_id="u1",
        thread_id="t1",
        model="claude-sonnet-4-5-20250929",
        enabled_skills=[],
        approval_rules=approval_rules or {},
        store=InMemoryStore(),
        saver=MemorySaver(),
        **kwargs,
    )


@pytest.mark.asyncio
async def test_build_km_agent_returns_compiled_graph():
    agent = await _build()
    assert agent is not None
    # CompiledStateGraph has an invoke method
    assert callable(getattr(agent, "invoke", None))


def test_make_public_wired_to_hitl_when_publish_require():
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    interrupt_on = _build_interrupt_on({"publish": "require"})
    assert interrupt_on.get("make_public") is True


def test_make_public_skipped_when_publish_auto():
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    interrupt_on = _build_interrupt_on({"publish": "auto"})
    assert interrupt_on.get("make_public") is False


def test_create_note_hitl_when_write_note_require():
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    interrupt_on = _build_interrupt_on({"write_note": "require"})
    assert interrupt_on.get("create_note") is True


def test_create_note_not_hitl_when_write_note_auto():
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    interrupt_on = _build_interrupt_on({"write_note": "auto"})
    assert interrupt_on.get("create_note") is False


def test_external_send_require_by_default():
    """external_send defaults to 'require' when not specified."""
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    interrupt_on = _build_interrupt_on({})
    assert interrupt_on.get("external_send") is True


def test_external_send_skipped_when_auto():
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    interrupt_on = _build_interrupt_on({"external_send": "auto"})
    assert interrupt_on.get("external_send") is False


def test_filter_tools_no_skills_returns_all():
    from km_agent import _filter_tools_for_skills  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    filtered = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=[])
    assert filtered == list(ALL_TOOLS)


def test_filter_tools_with_lit_triage_skill_filters_to_allowed_set():
    from km_agent import _filter_tools_for_skills  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    loaded = load_skills(only=["lit-triage"])
    filtered = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=loaded)
    names = {t.name for t in filtered}
    assert "search_notes" in names
    assert "list_references" in names
    assert "create_note" in names
    # Tools not in lit-triage's allow-list must be excluded
    assert "make_public" not in names
    assert "pdf_read_text" not in names
    assert "highlight" not in names


def test_paperset_tools_are_core_when_any_skill_active():
    """Regression for G-R6-15 / #107 round 6: papersets are first-class user
    content, so list/read/write tools must be available to the agent even when
    a non-data-extract skill is enabled. Previously, enabling lit-triage
    stripped browse_papersets/csv_read/csv_write_cell, so "list my papersets"
    silently routed to list_pdfs.
    """
    from km_agent import _filter_tools_for_skills  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    loaded = load_skills(only=["lit-triage"])
    filtered = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=loaded)
    names = {t.name for t in filtered}
    assert "browse_papersets" in names
    assert "csv_read" in names
    assert "csv_write_cell" in names


def test_core_tools_include_read_paper_explain_search_library():
    """Regression: read_paper, pdf_explain_passage, and search_library are
    real tools bound to the agent but were silently pruned by
    _filter_tools_for_skills when any skill (e.g. deep-read) was enabled,
    because deep-read's SKILL.md tools list omits them and they were not in
    _CORE_TOOL_NAMES. The reader side-panel agent in /papers/[id]/read needs
    these for multi-page reads, SelectionToolbar Explain, and cross-library
    RAG.
    """
    from km_agent import _filter_tools_for_skills  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    loaded = load_skills(only=["deep-read"])
    filtered = _filter_tools_for_skills(list(ALL_TOOLS), loaded_skills=loaded)
    names = {t.name for t in filtered}
    assert "read_paper" in names
    assert "pdf_explain_passage" in names
    assert "search_library" in names


def test_lit_triage_keeps_create_note_hitl():
    """lit-triage SKILL.md lists create_note under require_approval.

    Design decision (1.3d): create_note is a side-effecting write so HITL
    stays on by default for skills that opt in. Regression lock that the
    skill-frontmatter → interrupt_on plumbing keeps create_note=True even
    when the user-level approval_rules say write_note=auto, because skill
    require_approval is authoritative over the rule default.
    """
    from km_agent import _build_interrupt_on  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["lit-triage"])
    interrupt_on = _build_interrupt_on({"write_note": "auto"}, loaded_skills=loaded)
    assert interrupt_on.get("create_note") is True


def test_skill_require_approval_injects_into_interrupt_on():
    """deep-read require_approval should force highlight HITL."""
    from km_agent import _build_interrupt_on  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["deep-read"])
    interrupt_on = _build_interrupt_on({}, loaded_skills=loaded)
    assert interrupt_on.get("highlight") is True


def test_make_public_in_interrupt_on_from_tool_metadata():
    """make_public has require_approval=True in metadata — auto-detected."""
    from km_agent import _build_interrupt_on  # noqa: PLC0415
    from tools import ALL_TOOLS  # noqa: PLC0415

    has_make_public = any(t.name == "make_public" for t in ALL_TOOLS)
    assert has_make_public, "make_public must be in ALL_TOOLS"

    # With default approval_rules, make_public should be True (default publish=require)
    interrupt_on = _build_interrupt_on({"publish": "require"})
    assert interrupt_on["make_public"] is True


def test_metadata_true_preserved_when_publish_rule_absent():
    """If approval_rules omits 'publish', tool metadata (make_public=True) wins.

    Regression lock: previously the factory clobbered metadata-True with the
    default rule="require", which happened to also be True — but for write_note
    the default "auto" silently overwrote any metadata flag with False.
    """
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    # No 'publish' key → metadata for make_public must remain True.
    interrupt_on = _build_interrupt_on({})
    assert interrupt_on.get("make_public") is True


def test_metadata_true_for_create_note_preserved_when_write_note_rule_absent(monkeypatch):
    """If a tool advertises require_approval=True via metadata and no rule
    is set, the metadata flag must NOT be clobbered to False.

    Regression lock for the 'auto'-default clobber bug: before the fix,
    `_build_interrupt_on({})` set create_note=False because write_note
    defaulted to "auto", silently overwriting metadata-True.
    """
    import km_agent  # noqa: PLC0415
    from langchain_core.tools import tool  # noqa: PLC0415

    @tool
    def create_note(title: str) -> str:
        """Stub create_note tool with require_approval metadata."""
        return title

    create_note.metadata = {"require_approval": True}  # type: ignore[attr-defined]

    monkeypatch.setattr(km_agent, "ALL_TOOLS", [create_note])
    interrupt_on = km_agent._build_interrupt_on({})
    assert interrupt_on.get("create_note") is True


def test_explicit_auto_rule_downgrades_metadata_true(monkeypatch):
    """approval_rules is authoritative ONLY when explicitly set."""
    import km_agent  # noqa: PLC0415
    from langchain_core.tools import tool  # noqa: PLC0415

    @tool
    def create_note(title: str) -> str:
        """Stub create_note with metadata=True."""
        return title

    create_note.metadata = {"require_approval": True}  # type: ignore[attr-defined]

    monkeypatch.setattr(km_agent, "ALL_TOOLS", [create_note])
    # Explicit "auto" downgrades metadata-True → False.
    interrupt_on = km_agent._build_interrupt_on({"write_note": "auto"})
    assert interrupt_on.get("create_note") is False


def test_create_note_absent_when_no_metadata_no_rule():
    """create_note has no metadata flag and no rule → not in interrupt_on (or False)."""
    from km_agent import _build_interrupt_on  # noqa: PLC0415

    interrupt_on = _build_interrupt_on({})
    # Either absent or explicitly False — never True without metadata or rule.
    assert not interrupt_on.get("create_note", False)


def test_synthesis_keeps_create_note_hitl():
    """synthesis SKILL.md lists create_note under require_approval.

    Same design as lit-triage: create_note is a side-effecting write so the
    skill keeps HITL on by default. Regression lock for the
    skill-frontmatter → interrupt_on path.
    """
    from km_agent import _build_interrupt_on  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["synthesis"])
    interrupt_on = _build_interrupt_on({}, loaded_skills=loaded)
    assert interrupt_on.get("create_note") is True


def test_filter_tools_includes_core_tools_even_when_skill_omits_them():
    """CORE tools (e.g. list_notes) must remain available regardless of skill allow-lists.

    Regression lock: skills that don't list `list_notes` in their `tools:`
    frontmatter previously stripped it from the agent's toolset, making basic
    asks like "list my notes" fail with "I don't have that tool".
    """
    from pathlib import Path

    from langchain_core.tools import tool  # noqa: PLC0415

    from km_agent import _filter_tools_for_skills  # noqa: PLC0415
    from skills import SkillSpec  # noqa: PLC0415

    @tool
    def list_notes() -> str:
        """Stub list_notes."""
        return "ok"

    @tool
    def highlight() -> str:
        """Stub highlight."""
        return "ok"

    @tool
    def random() -> str:
        """Stub random tool not in core or skill."""
        return "ok"

    skill = SkillSpec(
        name="fake-skill",
        description="fixture",
        tools=["highlight"],
        subagents=[],
        require_approval=[],
        path=Path("/dev/null"),
    )

    filtered = _filter_tools_for_skills(
        [list_notes, highlight, random], loaded_skills=[skill]
    )
    names = {t.name for t in filtered}
    assert "list_notes" in names  # from CORE
    assert "highlight" in names  # from skill
    assert "random" not in names


# ------------------------------------------------------------- subagent wiring

def test_subagents_for_skills_lit_triage_yields_researcher():
    """A skill referencing `researcher` in its frontmatter triggers researcher inclusion."""
    from km_agent import _select_subagents  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["lit-triage"])
    names = [s["name"] for s in _select_subagents(loaded)]
    assert names == ["researcher"]


def test_subagents_for_skills_synthesis_yields_synthesizer():
    from km_agent import _select_subagents  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["synthesis"])
    names = [s["name"] for s in _select_subagents(loaded)]
    assert names == ["synthesizer"]


def test_subagents_for_skills_both_yields_both():
    from km_agent import _select_subagents  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["lit-triage", "synthesis"])
    names = sorted(s["name"] for s in _select_subagents(loaded))
    assert names == ["researcher", "synthesizer"]


def test_subagents_for_skill_with_no_subagents_yields_none():
    """Synthetic skill with subagents=[] returns no subagents.

    Replaces the deep-read variant — deep-read is parked in Phase 1.3h
    (body relies on stubbed PDF tools); revive in 1.5.1.
    """
    from pathlib import Path

    from km_agent import _select_subagents  # noqa: PLC0415
    from skills import SkillSpec  # noqa: PLC0415

    spec = SkillSpec(
        name="no-subs",
        description="fixture",
        tools=[],
        subagents=[],
        require_approval=[],
        path=Path("/virtual/no-subs/SKILL.md"),
    )
    assert _select_subagents([spec]) == []


def test_subagents_for_skills_deep_read_yields_none():
    """deep-read is an inline workflow skill, not a delegated subagent."""
    from km_agent import _select_subagents  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["deep-read"])
    assert _select_subagents(loaded) == []


def test_memory_prompt_mentions_deep_read_guidance_not_unavailable_fence():
    from km_agent import _MEMORY_SYSTEM_PROMPT  # noqa: PLC0415

    assert "`deep-read`" in _MEMORY_SYSTEM_PROMPT
    assert "deep paper reading workflow" in _MEMORY_SYSTEM_PROMPT
    assert "PDF full-text reading is NOT yet available in this build." not in _MEMORY_SYSTEM_PROMPT


def test_subagents_empty_when_no_skills():
    from km_agent import _select_subagents  # noqa: PLC0415

    assert _select_subagents([]) == []


def test_unknown_subagent_in_skill_logs_warning(caplog):
    """A skill listing a nonexistent subagent name must emit a WARNING log.

    Today's behavior silently dropped unknown names. Misconfigured skill
    frontmatter should be loud — a warning surfaces it without crashing the
    agent build (other valid subagents still resolve).
    """
    import logging
    from pathlib import Path

    from km_agent import _select_subagents  # noqa: PLC0415
    from skills import SkillSpec  # noqa: PLC0415

    bogus = SkillSpec(
        name="bogus-skill",
        description="fixture",
        tools=[],
        subagents=["does-not-exist", "researcher"],
        require_approval=[],
        path=Path("/dev/null"),
    )
    with caplog.at_level(logging.WARNING, logger="km_agent"):
        out = _select_subagents([bogus])

    # researcher still resolves; unknown is dropped.
    names = [s["name"] for s in out]
    assert names == ["researcher"]

    # Warning must mention skill name + bogus subagent name.
    matched = [
        rec for rec in caplog.records
        if rec.levelno == logging.WARNING
        and "does-not-exist" in rec.getMessage()
        and "bogus-skill" in rec.getMessage()
    ]
    assert matched, f"expected WARNING about unknown subagent; got: {caplog.records!r}"
