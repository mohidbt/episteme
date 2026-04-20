import hmac, hashlib, json, os, time
from unittest.mock import AsyncMock

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from main import app  # noqa: E402
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
        "X-Inhale-Document-Id": "1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def test_embed_chunks_stub_mode():
    """With INHALE_STUB_EMBEDDINGS=1, embeds are stubs. Mock DB to verify INSERT called."""
    mock_conn = AsyncMock()

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({
            "documentId": 1,
            "chunks": [
                {"chunkIndex": 0, "content": "hello", "pageStart": 1, "pageEnd": 1, "tokenCount": 1},
                {"chunkIndex": 1, "content": "world", "pageStart": 1, "pageEnd": 2, "tokenCount": 1},
            ],
        }).encode()
        r = client.post(
            "/agents/embed-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/embed-chunks", body),
        )
        assert r.status_code == 200
        data = r.json()
        assert data == {"inserted": 2}
        mock_conn.executemany.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_embed_chunks_rejects_empty_chunks():
    mock_conn = AsyncMock()

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({"documentId": 1, "chunks": []}).encode()
        r = client.post(
            "/agents/embed-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/embed-chunks", body),
        )
        assert r.status_code == 422  # validation error: min_length=1
    finally:
        app.dependency_overrides.clear()


def test_embed_chunks_unauthenticated():
    body = json.dumps({
        "documentId": 1,
        "chunks": [{"chunkIndex": 0, "content": "x", "pageStart": 1, "pageEnd": 1, "tokenCount": 1}],
    }).encode()
    r = client.post("/agents/embed-chunks", content=body)
    assert r.status_code == 401
