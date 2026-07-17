"""Tests for routers/openrouter_catalog — fetcher + endpoints.

Mocks httpx; runs refresh_catalog against a mock asyncpg connection,
and exercises GET/POST endpoints via FastAPI TestClient.
"""
import json
import hashlib
import hmac
import os
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

import deps.db  # noqa: E402
from deps.auth import canonical_signature_message  # noqa: E402
from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from routers import openrouter_catalog as cat  # noqa: E402

client = TestClient(app)


def _signed_headers(method: str, path: str, body: bytes = b"") -> dict[str, str]:
    ts = str(int(time.time()))
    message = canonical_signature_message(
        ts=ts,
        method=method,
        path=path,
        user_id="test-user",
        body=body,
    )
    signature = hmac.new(
        os.environ["INHALE_INTERNAL_SECRET"].encode(), message, hashlib.sha256
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "test-user",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig-Version": "2",
        "X-Inhale-Sig": signature,
    }


SAMPLE_RESPONSE = {
    "data": [
        {
            "id": "openai/gpt-4o-mini",
            "name": "GPT-4o mini",
            "context_length": 128000,
            "pricing": {"prompt": "0.00015", "completion": "0.0006"},
            "supported_parameters": ["tools", "tool_choice"],
        },
        {
            "id": "openai/gpt-5.4-nano",
            "name": "Gemma 4",
            "context_length": 8192,
            "pricing": {"prompt": "0", "completion": "0"},
            "supported_parameters": ["tools"],
        },
    ]
}


class _FakeHttpxResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeHttpxClient:
    def __init__(self, response_payload: dict):
        self._response_payload = response_payload
        self.last_url: str | None = None
        self.last_params: dict | None = None
        self.last_headers: dict | None = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, headers=None):
        self.last_url = url
        self.last_params = params
        self.last_headers = headers
        return _FakeHttpxResponse(self._response_payload)


@pytest.mark.asyncio
async def test_refresh_catalog_upserts_rows():
    fake_client = _FakeHttpxClient(SAMPLE_RESPONSE)
    mock_conn = AsyncMock()

    with patch("routers.openrouter_catalog.httpx.AsyncClient", lambda *a, **kw: fake_client):
        count = await cat.refresh_catalog(mock_conn, api_key=None)

    assert count == 2
    # No Authorization header sent when api_key is None.
    assert "Authorization" not in (fake_client.last_headers or {})
    assert fake_client.last_params == {"supported_parameters": "tools"}

    mock_conn.executemany.assert_called_once()
    sql, rows = mock_conn.executemany.call_args.args
    assert "INSERT INTO openrouter_catalog" in sql
    assert "ON CONFLICT (model_id) DO UPDATE" in sql
    assert len(rows) == 2
    ids = [r[0] for r in rows]
    assert "openai/gpt-4o-mini" in ids
    # Payload column is serialized JSON string.
    payload_json = rows[0][1]
    assert isinstance(payload_json, str)
    parsed = json.loads(payload_json)
    assert parsed["id"] in ids


@pytest.mark.asyncio
async def test_refresh_catalog_sends_authorization_when_key_set():
    fake_client = _FakeHttpxClient(SAMPLE_RESPONSE)
    mock_conn = AsyncMock()

    with patch("routers.openrouter_catalog.httpx.AsyncClient", lambda *a, **kw: fake_client):
        await cat.refresh_catalog(mock_conn, api_key="sk-or-test")

    assert fake_client.last_headers["Authorization"] == "Bearer sk-or-test"


@pytest.mark.asyncio
async def test_refresh_catalog_idempotent_on_repeat():
    """Second call upserts again — same model_ids, updated fetched_at."""
    fake_client = _FakeHttpxClient(SAMPLE_RESPONSE)
    mock_conn = AsyncMock()

    with patch("routers.openrouter_catalog.httpx.AsyncClient", lambda *a, **kw: fake_client):
        await cat.refresh_catalog(mock_conn, api_key=None)
        await cat.refresh_catalog(mock_conn, api_key=None)

    assert mock_conn.executemany.call_count == 2
    # Same row count both times.
    rows1 = mock_conn.executemany.call_args_list[0].args[1]
    rows2 = mock_conn.executemany.call_args_list[1].args[1]
    assert len(rows1) == len(rows2) == 2


def test_get_catalog_returns_rows_from_db():
    now = datetime.now(timezone.utc)
    payload_a = {"id": "a/m1", "name": "M1"}
    payload_b = {"id": "b/m2", "name": "M2"}
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = [
        {"payload": payload_a, "fetched_at": now},
        {"payload": payload_b, "fetched_at": now - timedelta(seconds=1)},
    ]

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        r = client.get("/openrouter/catalog")
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["models"]) == 2
        assert body["models"][0]["id"] == "a/m1"
        assert body["fetched_at"] is not None
    finally:
        app.dependency_overrides.clear()


def test_get_catalog_handles_string_payload():
    """asyncpg sometimes returns jsonb as str — endpoint must parse."""
    now = datetime.now(timezone.utc)
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = [
        {"payload": json.dumps({"id": "x/y", "name": "X"}), "fetched_at": now},
    ]

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        r = client.get("/openrouter/catalog")
        assert r.status_code == 200
        body = r.json()
        assert body["models"][0]["id"] == "x/y"
    finally:
        app.dependency_overrides.clear()


def test_get_catalog_empty_returns_empty_list():
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        r = client.get("/openrouter/catalog")
        assert r.status_code == 200
        body = r.json()
        assert body == {"models": [], "fetched_at": None}
    finally:
        app.dependency_overrides.clear()


def test_post_refresh_returns_count():
    fake_client = _FakeHttpxClient(SAMPLE_RESPONSE)
    mock_conn = AsyncMock()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        with patch("routers.openrouter_catalog.httpx.AsyncClient", lambda *a, **kw: fake_client):
            r = client.post(
                "/openrouter/catalog/refresh",
                headers=_signed_headers("POST", "/openrouter/catalog/refresh"),
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 2
        assert body["fetched_at"] is not None
    finally:
        app.dependency_overrides.clear()
