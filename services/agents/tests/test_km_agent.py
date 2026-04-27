"""RED tests for km_agent factory."""
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


def _build(approval_rules=None, **kwargs):
    """Helper — build with sensible test defaults."""
    from km_agent import build_km_agent  # noqa: PLC0415

    return build_km_agent(
        user_id="u1",
        thread_id="t1",
        model="claude-sonnet-4-5-20250929",
        enabled_skills=[],
        approval_rules=approval_rules or {},
        store=InMemoryStore(),
        saver=MemorySaver(),
        **kwargs,
    )


def test_build_km_agent_returns_compiled_graph():
    agent = _build()
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
    assert "extract_passages" not in names
    assert "highlight" not in names


def test_skill_require_approval_injects_into_interrupt_on():
    from km_agent import _build_interrupt_on  # noqa: PLC0415
    from skills import load_skills  # noqa: PLC0415

    loaded = load_skills(only=["lit-triage"])
    # Even though approval_rules sets write_note=auto, the skill's own
    # require_approval list re-enables HITL for create_note.
    interrupt_on = _build_interrupt_on({"write_note": "auto"}, loaded_skills=loaded)
    assert interrupt_on.get("create_note") is True


def test_skill_require_approval_for_highlight_via_deep_read():
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
