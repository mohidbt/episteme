import hmac, hashlib, json, os, time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)

NOTE_ID = "11111111-2222-3333-4444-555555555555"


@asynccontextmanager
async def _transaction():
    yield


def _mock_conn() -> AsyncMock:
    conn = AsyncMock()
    conn.fetchval.return_value = 1
    conn.transaction = MagicMock(return_value=_transaction())
    return conn


def _signed_headers(method: str, path: str, body: bytes):
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-Paper-Id": "00000000-0000-0000-0000-000000000001",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def test_embed_note_chunks_stub_mode():
    mock_conn = _mock_conn()

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({
            "noteId": NOTE_ID,
            "chunks": [
                {"chunkIdx": 0, "content": "hello"},
                {"chunkIdx": 1, "content": "world"},
            ],
        }).encode()
        r = client.post(
            "/agents/km/embed-note-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/km/embed-note-chunks", body),
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"inserted": 2}
        mock_conn.execute.assert_called_once()
        mock_conn.executemany.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_embed_note_chunks_rejects_empty_chunks():
    mock_conn = _mock_conn()

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({"noteId": NOTE_ID, "chunks": []}).encode()
        r = client.post(
            "/agents/km/embed-note-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/km/embed-note-chunks", body),
        )
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_embed_note_chunks_rejects_too_many_chunks():
    mock_conn = _mock_conn()

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        chunks = [{"chunkIdx": i, "content": "x"} for i in range(513)]
        body = json.dumps({"noteId": NOTE_ID, "chunks": chunks}).encode()
        r = client.post(
            "/agents/km/embed-note-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/km/embed-note-chunks", body),
        )
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_embed_note_chunks_unauthenticated():
    body = json.dumps({
        "noteId": NOTE_ID,
        "chunks": [{"chunkIdx": 0, "content": "x"}],
    }).encode()
    r = client.post("/agents/km/embed-note-chunks", content=body)
    assert r.status_code == 401


def test_embed_note_chunks_deletes_before_insert():
    call_order: list[str] = []
    mock_conn = _mock_conn()

    async def record_execute(*args, **kwargs):
        call_order.append("execute")

    async def record_executemany(*args, **kwargs):
        call_order.append("executemany")

    mock_conn.execute.side_effect = record_execute
    mock_conn.executemany.side_effect = record_executemany

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({
            "noteId": NOTE_ID,
            "chunks": [
                {"chunkIdx": 0, "content": "a"},
                {"chunkIdx": 1, "content": "b"},
            ],
        }).encode()
        r = client.post(
            "/agents/km/embed-note-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/km/embed-note-chunks", body),
        )
        assert r.status_code == 200, r.text
        assert call_order == ["execute", "executemany"]
    finally:
        app.dependency_overrides.clear()
