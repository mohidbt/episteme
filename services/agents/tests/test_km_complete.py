import hmac, hashlib, json, os, time
from unittest.mock import patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


def _signed_headers(method: str, path: str, body: bytes):
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


def _parse_sse_events(text: str):
    events = []
    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[len("data: "):]
        if payload == "[DONE]":
            events.append(("done", None))
        else:
            events.append(("data", json.loads(payload)))
    return events


def test_complete_streams_tokens_and_done():
    async def fake_stream(api_key, system, user):
        for tok in ["Hello", " ", "world"]:
            yield tok

    with patch("routers.km_complete._stream_tokens", fake_stream):
        body = json.dumps({"prompt": "say hi"}).encode()
        r = client.post(
            "/agents/km/complete",
            content=body,
            headers=_signed_headers("POST", "/agents/km/complete", body),
        )
        assert r.status_code == 200
        events = _parse_sse_events(r.text)
        token_events = [e[1] for e in events if e[0] == "data" and e[1].get("type") == "token"]
        assert [t["content"] for t in token_events] == ["Hello", " ", "world"]
        assert events[-1] == ("done", None)


def test_complete_includes_context_in_prompt():
    captured = {}

    async def fake_stream(api_key, system, user):
        captured["user"] = user
        captured["system"] = system
        if False:
            yield ""

    with patch("routers.km_complete._stream_tokens", fake_stream):
        body = json.dumps({
            "prompt": "Continue",
            "context": "The quick brown fox",
        }).encode()
        r = client.post(
            "/agents/km/complete",
            content=body,
            headers=_signed_headers("POST", "/agents/km/complete", body),
        )
        assert r.status_code == 200
        # Drain the streaming body
        _ = r.text
        assert "CONTEXT:" in captured["user"]
        assert "INSTRUCTION:" in captured["user"]
        assert "The quick brown fox" in captured["user"]
        assert "Continue" in captured["user"]


def test_complete_requires_prompt():
    body = json.dumps({"prompt": ""}).encode()
    r = client.post(
        "/agents/km/complete",
        content=body,
        headers=_signed_headers("POST", "/agents/km/complete", body),
    )
    assert r.status_code == 422


def test_complete_unauthenticated():
    body = json.dumps({"prompt": "hi"}).encode()
    r = client.post("/agents/km/complete", content=body)
    assert r.status_code == 401


def test_complete_emits_error_event_on_upstream_failure():
    async def boom(api_key, system, user):
        raise RuntimeError("upstream blew up")
        yield  # pragma: no cover

    with patch("routers.km_complete._stream_tokens", boom):
        body = json.dumps({"prompt": "hi"}).encode()
        r = client.post(
            "/agents/km/complete",
            content=body,
            headers=_signed_headers("POST", "/agents/km/complete", body),
        )
        assert r.status_code == 200
        events = _parse_sse_events(r.text)
        error_events = [e[1] for e in events if e[0] == "data" and e[1].get("type") == "error"]
        assert len(error_events) == 1
        assert "upstream blew up" in error_events[0]["message"]
        assert events[-1] == ("done", None)
