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


def test_invoke_error_event_on_exception():
    async def boom(*args, **kwargs):
        raise RuntimeError("agent blew up")
        yield  # pragma: no cover

    body = json.dumps({"thread_id": "t1", "message": "hi"}).encode()

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent(astream_events_coro=boom)):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    events = _parse_sse(r.text)
    error_events = [e for e in events if e["event"] == "error"]
    assert len(error_events) == 1
    assert "agent blew up" in error_events[0]["data"]["message"]


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

def test_state_returns_todos_and_pending_interrupts():
    path = "/agents/km/state/thread-abc"

    with patch("routers.km_agent.build_km_agent", return_value=_make_mock_agent()):
        r = client.get(
            path,
            headers=_signed_headers("GET", path, b""),
        )

    assert r.status_code == 200
    data = r.json()
    assert "todos" in data
    assert "pending_interrupts" in data
    assert data["todos"] == ["task A"]
    assert len(data["pending_interrupts"]) == 1
    pi = data["pending_interrupts"][0]
    assert pi["id"] == "t1"
    assert len(pi["interrupts"]) == 1


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
