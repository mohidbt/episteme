import hmac, hashlib, json, os, time
from unittest.mock import AsyncMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)

NOTE_A = "11111111-1111-1111-1111-111111111111"
NOTE_B = "22222222-2222-2222-2222-222222222222"


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


def _override_conn(mock_conn):
    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn


def test_km_chat_empty_retrieval_guard():
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []
    _override_conn(mock_conn)

    stream_called = {"count": 0}

    async def fake_stream(api_key, messages):
        stream_called["count"] += 1
        yield "should-not-run"

    try:
        with patch("routers.km_chat._stream_tokens", fake_stream):
            body = json.dumps({"question": "anything?"}).encode()
            r = client.post(
                "/agents/km/chat",
                content=body,
                headers=_signed_headers("POST", "/agents/km/chat", body),
            )
            assert r.status_code == 200
            events = _parse_sse_events(r.text)
            data_events = [e[1] for e in events if e[0] == "data"]
            assert data_events[0] == {"type": "sources", "notes": []}
            assert data_events[1]["type"] == "token"
            assert "could not find" in data_events[1]["content"]
            assert events[-1] == ("done", None)
            assert stream_called["count"] == 0
    finally:
        app.dependency_overrides.clear()


def test_km_chat_emits_sources_then_tokens():
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = [
        {
            "note_id": NOTE_A,
            "content": "Transformers use self-attention mechanisms to process sequences.",
            "score": 0.91,
            "title": "Transformers",
            "slug": "transformers",
        },
        {
            "note_id": NOTE_B,
            "content": "Attention is all you need — Vaswani et al. 2017.",
            "score": 0.82,
            "title": "Attention Paper",
            "slug": "attention-paper",
        },
    ]
    _override_conn(mock_conn)

    async def fake_stream(api_key, messages):
        for tok in ["Based", " on", " notes"]:
            yield tok

    try:
        with patch("routers.km_chat._stream_tokens", fake_stream):
            body = json.dumps({"question": "What is a transformer?"}).encode()
            r = client.post(
                "/agents/km/chat",
                content=body,
                headers=_signed_headers("POST", "/agents/km/chat", body),
            )
            assert r.status_code == 200
            events = _parse_sse_events(r.text)
            data_events = [e[1] for e in events if e[0] == "data"]
            assert data_events[0]["type"] == "sources"
            notes = data_events[0]["notes"]
            assert len(notes) == 2
            first = notes[0]
            assert set(first.keys()) == {"id", "title", "slug", "snippet"}
            assert first["id"] == NOTE_A
            assert first["title"] == "Transformers"
            assert first["slug"] == "transformers"
            assert first["snippet"].startswith("Transformers use self-attention")

            tokens = [e["content"] for e in data_events if e.get("type") == "token"]
            assert tokens == ["Based", " on", " notes"]
            assert events[-1] == ("done", None)
    finally:
        app.dependency_overrides.clear()


def test_km_chat_dedupes_by_note_id():
    mock_conn = AsyncMock()
    # 4 rows, 2 unique notes, already ordered DESC by score.
    mock_conn.fetch.return_value = [
        {"note_id": NOTE_A, "content": "A-top", "score": 0.99,
         "title": "Alpha", "slug": "alpha"},
        {"note_id": NOTE_B, "content": "B-top", "score": 0.88,
         "title": "Beta", "slug": "beta"},
        {"note_id": NOTE_A, "content": "A-lower", "score": 0.77,
         "title": "Alpha", "slug": "alpha"},
        {"note_id": NOTE_B, "content": "B-lower", "score": 0.66,
         "title": "Beta", "slug": "beta"},
    ]
    _override_conn(mock_conn)

    async def fake_stream(api_key, messages):
        yield "ok"

    try:
        with patch("routers.km_chat._stream_tokens", fake_stream):
            body = json.dumps({"question": "hi?"}).encode()
            r = client.post(
                "/agents/km/chat",
                content=body,
                headers=_signed_headers("POST", "/agents/km/chat", body),
            )
            assert r.status_code == 200
            events = _parse_sse_events(r.text)
            sources = next(e[1] for e in events if e[0] == "data"
                           and e[1].get("type") == "sources")
            assert len(sources["notes"]) == 2
            by_id = {n["id"]: n for n in sources["notes"]}
            assert by_id[NOTE_A]["snippet"].startswith("A-top")
            assert by_id[NOTE_B]["snippet"].startswith("B-top")
    finally:
        app.dependency_overrides.clear()


def test_km_chat_filters_by_user_id():
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []
    _override_conn(mock_conn)

    try:
        body = json.dumps({"question": "any?"}).encode()
        r = client.post(
            "/agents/km/chat",
            content=body,
            headers=_signed_headers("POST", "/agents/km/chat", body),
        )
        assert r.status_code == 200
        _ = r.text  # drain
        assert mock_conn.fetch.await_count == 1
        args = mock_conn.fetch.await_args.args
        # args[0] is SQL; args[1] is user_id ($1); args[2] is vector ($2)
        assert args[1] == "user_1"
    finally:
        app.dependency_overrides.clear()


def test_km_chat_rejects_empty_question():
    mock_conn = AsyncMock()
    _override_conn(mock_conn)
    try:
        body = json.dumps({"question": ""}).encode()
        r = client.post(
            "/agents/km/chat",
            content=body,
            headers=_signed_headers("POST", "/agents/km/chat", body),
        )
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_km_chat_unauthenticated():
    mock_conn = AsyncMock()
    _override_conn(mock_conn)
    try:
        body = json.dumps({"question": "hi"}).encode()
        r = client.post("/agents/km/chat", content=body)
        assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()
