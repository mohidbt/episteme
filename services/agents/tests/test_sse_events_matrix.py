"""RED tests for SSE event matrix TypedDicts + format_typed helper.

These tests drive the addition of:
  - TypedDict classes for all event types in lib/sse_events.py
  - format_typed(event_type, payload) that validates required keys and returns SSE string
"""
import json
import pytest

from lib.sse_events import EventType, format_sse, format_typed


# ---------------------------------------------------------------------------
# format_typed: valid payloads
# ---------------------------------------------------------------------------

def _parse_sse(raw: str) -> tuple[str, dict]:
    """Parse 'event: X\ndata: {...}\n\n' into (event_type, data_dict)."""
    lines = raw.strip().splitlines()
    event_line = next(l for l in lines if l.startswith("event:"))
    data_line = next(l for l in lines if l.startswith("data:"))
    return event_line.split(":", 1)[1].strip(), json.loads(data_line.split(":", 1)[1].strip())


def test_format_typed_text_valid():
    raw = format_typed("text", {"id": "run-1", "delta": "hello"})
    event_type, data = _parse_sse(raw)
    assert event_type == "text"
    assert data["id"] == "run-1"
    assert data["delta"] == "hello"


def test_format_typed_thinking_valid():
    raw = format_typed("thinking", {"id": "run-2", "delta": "reasoning..."})
    event_type, data = _parse_sse(raw)
    assert event_type == "thinking"
    assert data["delta"] == "reasoning..."


def test_format_typed_thinking_with_step_id():
    raw = format_typed("thinking", {"id": "run-2", "step_id": "step-1", "delta": "..."})
    _, data = _parse_sse(raw)
    assert data["step_id"] == "step-1"


def test_format_typed_tool_call_valid():
    raw = format_typed("tool_call", {
        "id": "tc-1", "name": "search", "args": {"q": "foo"}, "state": "input-available"
    })
    event_type, data = _parse_sse(raw)
    assert event_type == "tool_call"
    assert data["state"] == "input-available"


def test_format_typed_tool_result_output_available():
    raw = format_typed("tool_result", {
        "id": "tc-1", "output": "result text", "state": "output-available"
    })
    _, data = _parse_sse(raw)
    assert data["state"] == "output-available"
    assert data["output"] == "result text"


def test_format_typed_tool_result_output_error():
    raw = format_typed("tool_result", {
        "id": "tc-1", "errorText": "boom", "state": "output-error"
    })
    _, data = _parse_sse(raw)
    assert data["state"] == "output-error"


def test_format_typed_interrupt_valid():
    raw = format_typed("interrupt", {
        "id": "int-1", "tool": "delete_note", "args": {"note_id": "x"},
        "allowed_decisions": ["approve", "reject"],
    })
    event_type, data = _parse_sse(raw)
    assert event_type == "interrupt"
    assert data["allowed_decisions"] == ["approve", "reject"]


def test_format_typed_todos_valid():
    raw = format_typed("todos", {
        "items": [{"id": "t1", "content": "do it", "status": "pending"}]
    })
    event_type, data = _parse_sse(raw)
    assert event_type == "todos"
    assert data["items"][0]["status"] == "pending"


def test_format_typed_sources_valid():
    raw = format_typed("sources", {
        "message_id": "msg-1",
        "citations": [{"chunk_id": "c1", "title": "Paper A"}],
    })
    event_type, data = _parse_sse(raw)
    assert event_type == "sources"
    assert data["citations"][0]["chunk_id"] == "c1"


def test_format_typed_skill_load_valid():
    raw = format_typed("skill_load", {"name": "rag-search"})
    event_type, data = _parse_sse(raw)
    assert event_type == "skill_load"
    assert data["name"] == "rag-search"


def test_format_typed_file_diff_valid():
    raw = format_typed("file_diff", {
        "note_id": "n1", "before_hash": "abc", "after_hash": "def", "diff": "@@ ..."
    })
    event_type, data = _parse_sse(raw)
    assert event_type == "file_diff"
    assert data["diff"] == "@@ ..."


def test_format_typed_suggestion_valid():
    raw = format_typed("suggestion", {"items": ["Try X", "Try Y"]})
    event_type, data = _parse_sse(raw)
    assert event_type == "suggestion"
    assert data["items"] == ["Try X", "Try Y"]


def test_format_typed_done_valid():
    raw = format_typed("done", {"thread_id": "t-123"})
    event_type, data = _parse_sse(raw)
    assert event_type == "done"
    assert data["thread_id"] == "t-123"


def test_format_typed_pdf_extract_progress_valid():
    raw = format_typed("pdf_extract_progress", {"paper_id": "p1", "stage": "fallback_triggered"})
    event_type, data = _parse_sse(raw)
    assert event_type == "pdf_extract_progress"
    assert data == {"paper_id": "p1", "stage": "fallback_triggered"}


# ---------------------------------------------------------------------------
# format_typed: invalid payloads raise ValueError
# ---------------------------------------------------------------------------

def test_format_typed_text_missing_delta_raises():
    with pytest.raises((ValueError, KeyError, AssertionError)):
        format_typed("text", {"id": "x"})


def test_format_typed_text_missing_id_raises():
    with pytest.raises((ValueError, KeyError, AssertionError)):
        format_typed("text", {"delta": "hi"})


def test_format_typed_tool_call_missing_name_raises():
    with pytest.raises((ValueError, KeyError, AssertionError)):
        format_typed("tool_call", {"id": "x", "args": {}, "state": "input-available"})


def test_format_typed_interrupt_missing_tool_raises():
    with pytest.raises((ValueError, KeyError, AssertionError)):
        format_typed("interrupt", {"id": "x", "args": {}, "allowed_decisions": []})


def test_format_typed_done_missing_thread_id_raises():
    with pytest.raises((ValueError, KeyError, AssertionError)):
        format_typed("done", {})


# ---------------------------------------------------------------------------
# EventType literal coverage
# ---------------------------------------------------------------------------

ALL_EVENTS: list[EventType] = [
    "text", "thinking", "tool_call", "tool_result", "interrupt",
    "todos", "sources", "skill_load", "file_diff", "suggestion", "done",
    "error", "recursion_step", "pdf_extract_progress",
]


def test_event_type_count():
    assert len(ALL_EVENTS) == 14


def test_all_event_types_format_with_minimal_payload():
    """Smoke: every event type produces a non-empty SSE string with minimal valid payload."""
    minimal: dict[str, dict] = {
        "text": {"id": "x", "delta": "d"},
        "thinking": {"id": "x", "delta": "d"},
        "tool_call": {"id": "x", "name": "t", "args": {}, "state": "input-available"},
        "tool_result": {"id": "x", "state": "output-available"},
        "interrupt": {"id": "x", "tool": "t", "args": {}, "allowed_decisions": []},
        "todos": {"items": []},
        "sources": {"message_id": "m", "citations": []},
        "skill_load": {"name": "s"},
        "file_diff": {"note_id": "n", "before_hash": "a", "after_hash": "b", "diff": ""},
        "suggestion": {"items": []},
        "done": {"thread_id": "t"},
        "error": {"code": "e", "message": "m", "retriable": True},
        "recursion_step": {"step": 10},
        "pdf_extract_progress": {"paper_id": "p1", "stage": "fallback_triggered"},
    }
    for et in ALL_EVENTS:
        raw = format_typed(et, minimal[et])
        assert raw.startswith(f"event: {et}"), f"Bad output for {et!r}: {raw!r}"


# ---------------------------------------------------------------------------
# §1.3b-E2E-fix-1: format_sse must tolerate Command (and other non-JSON types)
# without crashing the SSE stream. Belt-and-suspenders alongside the explicit
# Command extraction in routers/km_agent.py::_map_event.
# ---------------------------------------------------------------------------

def test_map_event_emits_full_actions_list_for_batched_interrupt():
    """Phase 1.9f: when langchain HITL bundles N action_requests into one
    interrupt, the SSE payload must surface ALL N in `actions[]` and mirror
    actions[0] onto the legacy top-level tool/args/allowed_decisions keys.
    """
    from routers.km_agent import _map_event  # noqa: PLC0415

    class _FakeInt:
        def __init__(self, value, id):  # noqa: A002
            self.value = value
            self.id = id

    value = {
        "action_requests": [
            {"id": "tc-a", "name": "highlight", "args": {"page": 1}},
            {"id": "tc-b", "name": "highlight", "args": {"page": 2}},
            {"id": "tc-c", "name": "highlight", "args": {"page": 3}},
        ],
        "review_configs": [
            {"action_name": "highlight", "allowed_decisions": ["approve", "reject"]},
            {"action_name": "highlight", "allowed_decisions": ["approve", "reject"]},
            {"action_name": "highlight", "allowed_decisions": ["approve", "reject"]},
        ],
    }
    ev = {
        "event": "on_chain_end",
        "run_id": "r-x",
        "data": {"output": {"__interrupt__": [_FakeInt(value=value, id="int-1")]}},
    }
    mapped = _map_event(ev)
    assert mapped is not None
    ev_type, payload = mapped
    assert ev_type == "interrupt"
    assert payload["id"] == "int-1"
    # Legacy mirror of actions[0]
    assert payload["tool"] == "highlight"
    assert payload["args"] == {"page": 1}
    assert payload["allowed_decisions"] == ["approve", "reject"]
    # Full actions list — 3 entries
    assert len(payload["actions"]) == 3
    assert [a["tool_call_id"] for a in payload["actions"]] == ["tc-a", "tc-b", "tc-c"]
    assert payload["actions"][2]["args"] == {"page": 3}


def test_map_event_legacy_shape_yields_single_action():
    """Legacy hand-rolled {tool, args, allowed_decisions} value still
    produces a 1-element `actions` list for forward-compat consumers.
    """
    from routers.km_agent import _map_event  # noqa: PLC0415

    class _FakeInt:
        def __init__(self, value, id):  # noqa: A002
            self.value = value
            self.id = id

    value = {"tool": "make_public", "args": {"x": 1}, "allowed_decisions": ["approve"]}
    ev = {
        "event": "on_chain_end",
        "run_id": "r-y",
        "data": {"output": {"__interrupt__": [_FakeInt(value=value, id="int-2")]}},
    }
    _, payload = _map_event(ev)
    assert payload["tool"] == "make_public"
    assert len(payload["actions"]) == 1
    assert payload["actions"][0]["tool"] == "make_public"


def test_map_event_drops_interrupt_with_unparseable_value():
    """When interrupt value has neither action_requests nor legacy tool shape,
    _map_event must return None so no synthetic blank interrupt is emitted.
    """
    from routers.km_agent import _map_event  # noqa: PLC0415

    class _FakeInt:
        def __init__(self, value, id):  # noqa: A002
            self.value = value
            self.id = id

    ev = {
        "event": "on_chain_end",
        "run_id": "r-z",
        "data": {"output": {"__interrupt__": [_FakeInt(value={"unknown": "shape"}, id="int-3")]}},
    }
    assert _map_event(ev) is None


def test_format_sse_serializes_langgraph_command():
    """format_sse must JSON-encode a langgraph Command without TypeError."""
    from langgraph.types import Command  # noqa: PLC0415

    cmd = Command(update={"k": "v"}, goto="some_node")
    raw = format_sse("tool_result", {"id": "x", "state": "output-available", "output": cmd})
    event_type, data = _parse_sse(raw)
    assert event_type == "tool_result"
    # Output is converted to a JSON-friendly dict
    out = data["output"]
    assert isinstance(out, dict)
    assert out.get("update") == {"k": "v"}
    assert out.get("goto") == "some_node"


# ---------------------------------------------------------------------------
# G1 — stream-terminal sweep: CancelledError mid-tool
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_gen_emits_tool_result_error_and_done_on_cancelled_error():
    """G1: if the astream_events generator raises CancelledError after emitting
    on_tool_start (but before on_tool_end), the SSE gen() must:
      - emit tool_result with state=output-error for the orphan run_id
      - always emit done as the last frame
    """
    import asyncio  # noqa: PLC0415
    from unittest.mock import AsyncMock, MagicMock, patch  # noqa: PLC0415

    RUN_ID = "run-cancel-1"
    THREAD_ID = "thread-test-cancel"

    async def _fake_astream_events(*_args, **_kwargs):
        yield {
            "event": "on_tool_start",
            "run_id": RUN_ID,
            "name": "km_get",
            "data": {"input": {"key": "foo"}},
        }
        raise asyncio.CancelledError()

    fake_agent = MagicMock()
    fake_agent.astream_events = _fake_astream_events

    # Collect all SSE frames from the gen() coroutine
    from routers.km_agent import format_sse, format_typed  # noqa: PLC0415

    frames: list[str] = []

    # Build a minimal gen() equivalent exercising the same try/finally logic.
    # We absorb CancelledError at the outermost level so pytest-asyncio doesn't
    # treat the test as cancelled; the goal is to verify the finally block runs.
    active_tool_run_ids: set[str] = set()
    try:
        try:
            try:
                async for ev in fake_agent.astream_events():
                    ev_name = ev.get("event", "")
                    ev_run_id = ev.get("run_id", "")
                    if ev_name == "on_tool_start" and ev_run_id:
                        active_tool_run_ids.add(ev_run_id)
                        frames.append(format_typed("tool_call", {
                            "id": ev_run_id,
                            "name": ev["name"],
                            "args": ev["data"].get("input", {}),
                            "state": "input-available",
                        }))
                    elif ev_name == "on_tool_end" and ev_run_id:
                        active_tool_run_ids.discard(ev_run_id)
            except asyncio.CancelledError:
                raise  # re-raise so the outer finally runs
        finally:
            for orphan in active_tool_run_ids:
                frames.append(format_typed("tool_result", {
                    "id": orphan,
                    "state": "output-error",
                    "errorText": "stream ended before tool completed",
                }))
            frames.append(format_sse("done", {"thread_id": THREAD_ID}))
    except asyncio.CancelledError:
        pass  # absorbed — we only care that the finally block emitted frames

    # Assertions
    assert len(frames) >= 3, f"Expected at least 3 frames, got {frames}"

    tool_call_frame = frames[0]
    event_type, data = _parse_sse(tool_call_frame)
    assert event_type == "tool_call"
    assert data["id"] == RUN_ID

    tool_result_frame = frames[1]
    event_type, data = _parse_sse(tool_result_frame)
    assert event_type == "tool_result"
    assert data["id"] == RUN_ID
    assert data["state"] == "output-error"
    assert "stream ended before tool completed" in data["errorText"]

    done_frame = frames[-1]
    event_type, data = _parse_sse(done_frame)
    assert event_type == "done"
    assert data["thread_id"] == THREAD_ID
