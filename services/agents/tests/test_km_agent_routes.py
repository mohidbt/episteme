"""RED → GREEN tests for /agents/km/{invoke,resume,state,config} routes."""
import hmac
import hashlib
import json
import os
import time
from unittest.mock import MagicMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _signed_headers(method: str, path: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def _parse_sse(text: str) -> list[dict]:
    """Parse `event: X\ndata: Y` SSE frames into list of {event, data}."""
    events = []
    current_event = None
    for line in text.splitlines():
        if line.startswith("event: "):
            current_event = line[len("event: "):]
        elif line.startswith("data: "):
            data = json.loads(line[len("data: "):])
            events.append({"event": current_event, "data": data})
            current_event = None
    return events


async def _fake_astream_events(input_, config, version):
    """Fake astream_events v2 yielding one of each mapped event type."""
    # on_chat_model_stream → text
    yield {
        "event": "on_chat_model_stream",
        "run_id": "r1",
        "data": {"chunk": MagicMock(content="hello")},
    }
    # on_tool_start → tool_call
    yield {
        "event": "on_tool_start",
        "run_id": "r2",
        "name": "search_notes",
        "data": {"input": {"query": "test"}},
    }
    # on_tool_end → tool_result
    yield {
        "event": "on_tool_end",
        "run_id": "r2",
        "name": "search_notes",
        "data": {"output": MagicMock(content="found 3 notes")},
    }
    # on_chain_end with __interrupt__ → interrupt
    yield {
        "event": "on_chain_end",
        "run_id": "r3",
        "name": "some_node",
        "data": {
            "output": {
                "__interrupt__": [
                    MagicMock(
                        value={"tool": "make_public", "args": {"note_id": "n1"}},
                        id="int-1",
                    )
                ]
            }
        },
    }


def _make_mock_agent(astream_events_coro=None):
    agent = MagicMock()
    agent.astream_events = astream_events_coro or _fake_astream_events
    # For state test
    snapshot = MagicMock()
    snapshot.values = {"todos": ["task A"]}
    task_with_interrupt = MagicMock()
    task_with_interrupt.id = "t1"
    task_with_interrupt.interrupts = [MagicMock(value={"tool": "make_public"})]
    snapshot.tasks = [task_with_interrupt]
    agent.get_state = MagicMock(return_value=snapshot)
    return agent


# ---------------------------------------------------------------------------
# Auth guard — all routes must reject unsigned requests
# ---------------------------------------------------------------------------

def test_invoke_requires_auth():
    body = json.dumps({"thread_id": "t1", "message": "hi"}).encode()
    r = client.post("/agents/km/invoke", content=body)
    assert r.status_code == 401


def test_resume_requires_auth():
    body = json.dumps({"thread_id": "t1", "decisions": []}).encode()
    r = client.post("/agents/km/resume", content=body)
    assert r.status_code == 401


def test_state_requires_auth():
    r = client.get("/agents/km/state/thread-1")
    assert r.status_code == 401


def test_config_post_requires_auth():
    body = json.dumps({"modelPreference": "openai/gpt-4o"}).encode()
    r = client.post("/agents/km/config", content=body)
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# /invoke
# ---------------------------------------------------------------------------

def test_invoke_streams_sse_events():
    body = json.dumps({"thread_id": "t1", "message": "hello"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent()):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]

    events = _parse_sse(r.text)
    event_types = [e["event"] for e in events]

    # Must contain text, tool_call, tool_result, interrupt, done
    assert "text" in event_types
    assert "tool_call" in event_types
    assert "tool_result" in event_types
    assert "interrupt" in event_types
    assert "done" in event_types


def test_invoke_text_event_has_delta():
    body = json.dumps({"thread_id": "t1", "message": "hello"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent()):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    events = _parse_sse(r.text)
    text_events = [e for e in events if e["event"] == "text"]
    assert len(text_events) >= 1
    assert "delta" in text_events[0]["data"]
    assert text_events[0]["data"]["delta"] == "hello"


def test_invoke_tool_call_event_shape():
    body = json.dumps({"thread_id": "t1", "message": "hello"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent()):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    events = _parse_sse(r.text)
    tc_events = [e for e in events if e["event"] == "tool_call"]
    assert len(tc_events) >= 1
    d = tc_events[0]["data"]
    assert "name" in d
    assert "args" in d
    assert d["name"] == "search_notes"


def test_invoke_tool_result_event_shape():
    body = json.dumps({"thread_id": "t1", "message": "hello"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent()):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    events = _parse_sse(r.text)
    tr_events = [e for e in events if e["event"] == "tool_result"]
    assert len(tr_events) >= 1
    d = tr_events[0]["data"]
    # v1 matrix: tool_result carries id + state + output? (no name field)
    assert "id" in d
    assert "state" in d
    assert "output" in d


def test_invoke_done_event_contains_thread_id():
    body = json.dumps({"thread_id": "t1", "message": "hello"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent()):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    events = _parse_sse(r.text)
    done_events = [e for e in events if e["event"] == "done"]
    assert len(done_events) == 1
    assert done_events[0]["data"]["thread_id"] == "t1"


def test_invoke_no_error_sse_event_on_exception():
    """Exceptions in astream_events must NOT produce an error SSE event — they propagate.

    We verify this by checking that if the exception bubbles, it isn't wrapped in SSE.
    The TestClient re-raises streaming exceptions, so we catch the RuntimeError directly.
    """
    import pytest  # noqa: PLC0415

    async def boom(*args, **kwargs):
        raise RuntimeError("agent blew up")
        yield  # pragma: no cover

    body = json.dumps({"thread_id": "t1", "message": "hi"}).encode()

    no_raise_client = TestClient(app, raise_server_exceptions=False)

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent(astream_events_coro=boom)):
        r = no_raise_client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    # Response text must NOT contain an SSE error event
    assert "event: error" not in r.text


# ---------------------------------------------------------------------------
# /resume
# ---------------------------------------------------------------------------

def test_resume_calls_astream_events_with_command():
    """resume must pass Command(resume=decisions) to agent.astream_events."""
    captured = {}

    async def capture_input(input_, config, version):
        from langgraph.types import Command  # noqa: PLC0415
        captured["input"] = input_
        captured["is_command"] = isinstance(input_, Command)
        captured["resume_value"] = getattr(input_, "resume", None)
        if False:
            yield

    agent = _make_mock_agent(astream_events_coro=capture_input)
    body = json.dumps({"thread_id": "t1", "decisions": [{"id": "int-1", "action": "approve"}]}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=agent):
        r = client.post(
            "/agents/km/resume",
            content=body,
            headers=_signed_headers("POST", "/agents/km/resume", body),
        )

    assert r.status_code == 200
    assert captured["is_command"] is True
    assert captured["resume_value"] == [{"id": "int-1", "action": "approve"}]


def test_resume_streams_done_event():
    body = json.dumps({"thread_id": "t2", "decisions": []}).encode()

    async def empty(*args, **kwargs):
        if False:
            yield

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent(astream_events_coro=empty)):
        r = client.post(
            "/agents/km/resume",
            content=body,
            headers=_signed_headers("POST", "/agents/km/resume", body),
        )

    events = _parse_sse(r.text)
    done_events = [e for e in events if e["event"] == "done"]
    assert len(done_events) == 1
    assert done_events[0]["data"]["thread_id"] == "t2"


# ---------------------------------------------------------------------------
# /state/{thread_id}
# ---------------------------------------------------------------------------

def test_state_returns_empty_when_no_checkpoint():
    """When aget_tuple returns None, state returns empty todos/pending_interrupts."""
    from unittest.mock import AsyncMock  # noqa: PLC0415

    path = "/agents/km/state/thread-new"
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=None)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        r = client.get(
            path,
            headers=_signed_headers("GET", path, b""),
        )

    assert r.status_code == 200
    data = r.json()
    assert data == {"todos": [], "pending_interrupts": []}


def test_state_returns_todos_from_checkpoint():
    """When aget_tuple returns a checkpoint, todos are extracted from channel_values."""
    from unittest.mock import AsyncMock  # noqa: PLC0415

    path = "/agents/km/state/thread-abc"
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": ["task A", "task B"]}}

    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        r = client.get(
            path,
            headers=_signed_headers("GET", path, b""),
        )

    assert r.status_code == 200
    data = r.json()
    assert "todos" in data
    assert "pending_interrupts" in data
    assert data["todos"] == ["task A", "task B"]
    assert data["pending_interrupts"] == []


# ---------------------------------------------------------------------------
# /config POST
# ---------------------------------------------------------------------------

def test_config_post_returns_ok():
    from lib import config_cache  # noqa: PLC0415
    config_cache._CACHE.clear()

    body = json.dumps({"modelPreference": "openai/gpt-4o", "approvalRules": {}}).encode()
    r = client.post(
        "/agents/km/config",
        content=body,
        headers=_signed_headers("POST", "/agents/km/config", body),
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_config_post_persists_for_subsequent_load():
    from lib import config_cache  # noqa: PLC0415
    config_cache._CACHE.clear()

    body = json.dumps({"modelPreference": "openai/gpt-4o-mini"}).encode()
    client.post(
        "/agents/km/config",
        content=body,
        headers=_signed_headers("POST", "/agents/km/config", body),
    )

    from lib.config_cache import load_user_config  # noqa: PLC0415
    cfg = load_user_config("user_1")
    assert cfg["modelPreference"] == "openai/gpt-4o-mini"


# ---------------------------------------------------------------------------
# Guest mode (Task 13) — guest user_id is forbidden from /agents/km routes
# ---------------------------------------------------------------------------

def _guest_headers(method: str, path: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "guest",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def test_guest_invoke_returns_403():
    body = json.dumps({"thread_id": "t1", "message": "hi"}).encode()
    r = client.post(
        "/agents/km/invoke",
        content=body,
        headers=_guest_headers("POST", "/agents/km/invoke", body),
    )
    assert r.status_code == 403
    assert r.json()["detail"] == {
        "error": "guests cannot use agents",
        "code": "guest_forbidden",
    }


def test_guest_resume_returns_403():
    body = json.dumps({"thread_id": "t1", "decisions": []}).encode()
    r = client.post(
        "/agents/km/resume",
        content=body,
        headers=_guest_headers("POST", "/agents/km/resume", body),
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "guest_forbidden"


def test_guest_state_returns_403():
    path = "/agents/km/state/whatever"
    r = client.get(
        path,
        headers=_guest_headers("GET", path, b""),
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "guest_forbidden"


def test_guest_config_post_returns_403():
    body = json.dumps({"modelPreference": "openai/gpt-4o"}).encode()
    r = client.post(
        "/agents/km/config",
        content=body,
        headers=_guest_headers("POST", "/agents/km/config", body),
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "guest_forbidden"


def test_guest_config_post_does_not_persist():
    """Guest 403 must not write to the cache."""
    from lib import config_cache  # noqa: PLC0415
    config_cache._CACHE.clear()

    body = json.dumps({"modelPreference": "openai/gpt-4o"}).encode()
    client.post(
        "/agents/km/config",
        content=body,
        headers=_guest_headers("POST", "/agents/km/config", body),
    )
    assert "guest" not in config_cache._CACHE


# ---------------------------------------------------------------------------
# /agents/km/debug/loaded_skills — test-only debug endpoint (HMAC-gated).
#
# Used by scripts/check-skill-addition.ts to assert load_skills() resolved
# the fixture skill before the /invoke smoke. Without this, /invoke 200
# could mask a silently-skipped skill — see strengthen #1.
# ---------------------------------------------------------------------------

def test_debug_loaded_skills_requires_auth():
    r = client.get("/agents/km/debug/loaded_skills?only=lit-triage")
    assert r.status_code == 401


def test_debug_loaded_skills_returns_resolved_specs():
    """A real skill name resolves and reports its tool/subagent allow-list."""
    path = "/agents/km/debug/loaded_skills?only=lit-triage"
    r = client.get(path, headers=_signed_headers("GET", path, b""))
    assert r.status_code == 200
    payload = r.json()
    assert isinstance(payload, list)
    assert len(payload) == 1
    spec = payload[0]
    assert spec["name"] == "lit-triage"
    assert isinstance(spec["tools"], list)
    assert isinstance(spec["subagents"], list)
    # lit-triage references researcher per its frontmatter
    assert "researcher" in spec["subagents"]


def test_debug_loaded_skills_unknown_returns_500():
    """Unknown skill in `only` surfaces load_skills() KeyError as 500.

    The scalability gate relies on this — a fixture name that fails to load
    should fail the gate loudly rather than be silently skipped.
    """
    path = "/agents/km/debug/loaded_skills?only=does-not-exist"
    r = client.get(path, headers=_signed_headers("GET", path, b""))
    assert r.status_code == 500


def test_debug_loaded_skills_multiple_only_values():
    """Multiple `only` query repeats are aggregated."""
    path = "/agents/km/debug/loaded_skills?only=lit-triage&only=synthesis"
    r = client.get(path, headers=_signed_headers("GET", path, b""))
    assert r.status_code == 200
    names = sorted(s["name"] for s in r.json())
    assert names == ["lit-triage", "synthesis"]


def test_debug_loaded_skills_guest_returns_403():
    """Guests cannot probe agent state."""
    path = "/agents/km/debug/loaded_skills?only=lit-triage"
    r = client.get(path, headers=_guest_headers("GET", path, b""))
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# §1.3b-E2E-fix-1: Command-typed tool outputs must JSON-serialize cleanly.
#
# deepagents built-in tools (write_todos, ls, edit_file, task) return
# `langgraph.types.Command` instances from on_tool_end. Without conversion,
# `json.dumps` raises `TypeError: Object of type Command is not JSON
# serializable` and the SSE stream dies mid-flight.
# ---------------------------------------------------------------------------

def test_invoke_handles_command_typed_tool_output():
    """on_tool_end with a Command output must NOT raise TypeError.

    Reproduces: lit-triage / skill-toggle / non-guest E2E flows surface a
    `TypeError: Object of type Command is not JSON serializable` when the
    `task` (subagent) tool returns a Command(update={...}). The router must
    convert Command into a JSON-friendly shape before format_sse runs.
    """
    from langgraph.types import Command  # noqa: PLC0415

    cmd = Command(update={"messages": [{"role": "tool", "content": "subagent done"}]})

    async def _stream_with_command(input_, config, version):
        yield {
            "event": "on_tool_end",
            "run_id": "tc-cmd",
            "name": "task",
            "data": {"output": cmd},
        }

    body = json.dumps({"thread_id": "t1", "message": "hi"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent(astream_events_coro=_stream_with_command)):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    # Stream must complete without TypeError surfacing as a 500 / hung response.
    assert r.status_code == 200
    events = _parse_sse(r.text)
    tr_events = [e for e in events if e["event"] == "tool_result"]
    assert len(tr_events) >= 1, "Expected a tool_result event for the Command-returning tool"
    # The output must be JSON-serializable (it parsed) and recognizable as a Command shape.
    out = tr_events[0]["data"].get("output")
    assert out is not None
    assert isinstance(out, dict), f"Expected Command serialized to dict, got {type(out).__name__}"
    # Must carry the update payload so the FE can still render the result.
    assert "update" in out, f"Expected serialized Command to expose 'update', got keys: {sorted(out.keys())}"


def test_invoke_handles_command_inside_interrupt_value():
    """on_chain_end interrupt whose value contains Command-like objects must serialize.

    Defensive: we don't currently see Command nested in interrupt.value, but if
    a future skill plumbs one through, we must not crash the SSE stream.
    """
    from langgraph.types import Command  # noqa: PLC0415

    inner_cmd = Command(update={"foo": "bar"})

    async def _stream_with_interrupt(input_, config, version):
        yield {
            "event": "on_chain_end",
            "run_id": "r-int",
            "name": "node",
            "data": {
                "output": {
                    "__interrupt__": [
                        MagicMock(
                            value={
                                "tool": "make_public",
                                "args": {"note_id": "n1", "command": inner_cmd},
                                "allowed_decisions": ["approve", "reject"],
                            },
                            id="int-7",
                        )
                    ]
                }
            },
        }

    body = json.dumps({"thread_id": "t1", "message": "hi"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent(astream_events_coro=_stream_with_interrupt)):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    assert r.status_code == 200
    events = _parse_sse(r.text)
    int_events = [e for e in events if e["event"] == "interrupt"]
    assert len(int_events) >= 1


# ---------------------------------------------------------------------------
# §1.3b-E2E-fix-2: agent recursion_limit raised above langgraph default of 25.
#
# Default 25 is too tight for Deep Agents w/ subagents — a healthy lit-triage
# flow plans + delegates to researcher + iterates results, easily exceeding 25
# steps. Raise the per-invocation limit and document the choice.
# ---------------------------------------------------------------------------

def test_invoke_passes_recursion_limit_to_astream_events():
    """invoke must pass recursion_limit=100 in the astream_events config."""
    captured: dict = {}

    async def _capture(input_, config, version):
        captured["config"] = config
        if False:
            yield

    body = json.dumps({"thread_id": "t1", "message": "hi"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent(astream_events_coro=_capture)):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    assert r.status_code == 200
    cfg = captured["config"]
    assert cfg.get("recursion_limit") == 100, (
        f"Deep Agents w/ subagents need recursion_limit > langgraph default 25; "
        f"got {cfg.get('recursion_limit')!r}"
    )


def test_resume_passes_recursion_limit_to_astream_events():
    """resume must pass recursion_limit=100 in the astream_events config."""
    captured: dict = {}

    async def _capture(input_, config, version):
        captured["config"] = config
        if False:
            yield

    body = json.dumps({"thread_id": "t1", "decisions": []}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent(astream_events_coro=_capture)):
        r = client.post(
            "/agents/km/resume",
            content=body,
            headers=_signed_headers("POST", "/agents/km/resume", body),
        )

    assert r.status_code == 200
    cfg = captured["config"]
    assert cfg.get("recursion_limit") == 100
