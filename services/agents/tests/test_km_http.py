"""RED tests for services/agents/lib/km_http.py — outbound HMAC client."""
import hashlib
import hmac
import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _expected_sig(secret: str, ts: str, method: str, path: str, body: bytes) -> str:
    msg = ts.encode() + method.encode() + path.encode() + body
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# km_post — HMAC headers + body shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_km_post_sends_correct_hmac_headers():
    """km_post must send X-Inhale-Sig computed from ts+method+path+body."""
    from lib.km_http import km_post  # noqa: PLC0415

    captured: dict = {}

    async def mock_post(url, *, content, headers, **kwargs):
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = content
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.raise_for_status = lambda: None
        resp.json = lambda: {"id": "note-1"}
        return resp

    with patch("lib.km_http._client") as mock_client:
        mock_client.post = mock_post
        result = await km_post("/api/notes", {"title": "Hello"}, user_id="u1")

    assert result == {"id": "note-1"}
    hdrs = captured["headers"]
    assert hdrs["X-Inhale-User-Id"] == "u1"
    assert "X-Inhale-Ts" in hdrs
    assert "X-Inhale-Sig" in hdrs
    assert hdrs["Content-Type"] == "application/json"

    # Verify HMAC matches
    body_bytes = captured["body"]
    secret = "test-secret-abc"
    ts = hdrs["X-Inhale-Ts"]
    expected = _expected_sig(secret, ts, "POST", "/api/notes", body_bytes)
    assert hdrs["X-Inhale-Sig"] == expected


@pytest.mark.asyncio
async def test_km_post_base_url_from_env():
    """km_post uses EPISTEME_KM_BASE_URL from env."""

    captured: dict = {}

    async def mock_post(url, *, content, headers, **kwargs):
        captured["url"] = url
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.raise_for_status = lambda: None
        resp.json = lambda: {}
        return resp

    with patch.dict(os.environ, {"EPISTEME_KM_BASE_URL": "http://km-custom:9999"}):
        # Reload module to pick up new env
        import importlib

        import lib.km_http as km_http_mod  # noqa: PLC0415

        importlib.reload(km_http_mod)
        with patch.object(km_http_mod, "_client") as mock_client:
            mock_client.post = mock_post
            await km_http_mod.km_post("/api/notes", {}, user_id="u1")

    assert captured["url"].startswith("http://km-custom:9999")


@pytest.mark.asyncio
async def test_km_get_sends_correct_hmac_headers():
    """km_get must send HMAC headers with empty body."""
    from lib.km_http import km_get  # noqa: PLC0415

    captured: dict = {}

    async def mock_get(url, *, headers, **kwargs):
        captured["url"] = url
        captured["headers"] = headers
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.raise_for_status = lambda: None
        resp.json = lambda: []
        return resp

    with patch("lib.km_http._client") as mock_client:
        mock_client.get = mock_get
        result = await km_get("/api/notes", user_id="u2")

    assert result == []
    hdrs = captured["headers"]
    assert hdrs["X-Inhale-User-Id"] == "u2"
    ts = hdrs["X-Inhale-Ts"]
    expected = _expected_sig("test-secret-abc", ts, "GET", "/api/notes", b"")
    assert hdrs["X-Inhale-Sig"] == expected


@pytest.mark.asyncio
async def test_km_patch_sends_correct_hmac_headers():
    """km_patch must use PATCH method in HMAC computation."""
    from lib.km_http import km_patch  # noqa: PLC0415

    captured: dict = {}

    async def mock_patch(url, *, content, headers, **kwargs):
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = content
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.raise_for_status = lambda: None
        resp.json = lambda: {"updated": True}
        return resp

    with patch("lib.km_http._client") as mock_client:
        mock_client.patch = mock_patch
        result = await km_patch("/api/notes/abc", {"contentMd": "new"}, user_id="u3")

    assert result == {"updated": True}
    hdrs = captured["headers"]
    ts = hdrs["X-Inhale-Ts"]
    expected = _expected_sig("test-secret-abc", ts, "PATCH", "/api/notes/abc", captured["body"])
    assert hdrs["X-Inhale-Sig"] == expected


@pytest.mark.asyncio
async def test_km_post_returns_error_dict_on_non_2xx():
    """Non-2xx must return a structured error dict (not raise) so the
    LangGraph tool stream stays alive and the LLM can see the failure."""
    from lib.km_http import km_post  # noqa: PLC0415

    async def mock_post(url, *, content, headers, **kwargs):
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 403
        resp.is_success = False
        resp.json.return_value = {"error": "forbidden"}
        resp.text = '{"error":"forbidden"}'
        resp.request = MagicMock()
        resp.request.url = url
        return resp

    with patch("lib.km_http._client") as mock_client:
        mock_client.post = mock_post
        result = await km_post("/api/notes", {}, user_id="u1")
    assert isinstance(result, dict)
    assert result["error"] is True
    assert result["status"] == 403
    assert result["body"] == {"error": "forbidden"}


@pytest.mark.asyncio
async def test_km_get_returns_error_dict_on_request_error():
    """Transport-layer errors (e.g. ConnectError when target is down) must
    surface as a structured error dict, not propagate up the stream."""
    from lib.km_http import km_get  # noqa: PLC0415

    async def mock_get(url, *, headers, **kwargs):
        raise httpx.ConnectError("connection refused", request=MagicMock())

    with patch("lib.km_http._client") as mock_client:
        mock_client.get = mock_get
        result = await km_get("/api/notes", user_id="u1")
    assert isinstance(result, dict)
    assert result["error"] is True
    assert result["status"] is None
    assert "ConnectError" in result["body"]


@pytest.mark.asyncio
async def test_reader_get_uses_reader_base_url():
    """reader_get uses EPISTEME_READER_BASE_URL, not KM base URL."""
    import importlib

    import lib.km_http as km_http_mod  # noqa: PLC0415

    with patch.dict(
        os.environ,
        {
            "EPISTEME_READER_BASE_URL": "http://reader-custom:8888",
            "EPISTEME_KM_BASE_URL": "http://km-custom:9999",
        },
    ):
        importlib.reload(km_http_mod)
        captured: dict = {}

        async def mock_get(url, *, headers, **kwargs):
            captured["url"] = url
            resp = MagicMock(spec=httpx.Response)
            resp.status_code = 200
            resp.raise_for_status = lambda: None
            resp.json = lambda: []
            return resp

        with patch.object(km_http_mod, "_reader_client") as mock_client:
            mock_client.get = mock_get
            await km_http_mod.reader_get("/api/pdfs", user_id="u1")

    assert captured["url"].startswith("http://reader-custom:8888")


# ---------------------------------------------------------------------------
# GSD-102 Bug 2 — 204 / empty body handling on writes
# ---------------------------------------------------------------------------


def _make_204_response() -> MagicMock:
    """httpx.Response stand-in matching what KM returns from
    `new NextResponse(null, { status: 204 })` — empty body, real .json()
    raises JSONDecodeError just like httpx would.
    """
    import json as _json

    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 204
    resp.is_success = True
    resp.content = b""
    resp.text = ""

    def _raise():
        raise _json.JSONDecodeError("Expecting value", "", 0)

    resp.json = _raise
    return resp


@pytest.mark.asyncio
async def test_km_post_returns_ok_dict_on_204_no_content():
    """KM routes like POST /api/folders/move return 204 with empty body.
    km_post must NOT call .json() on empty content — that raises
    JSONDecodeError into the LangGraph stream (GSD-102 bug 2)."""
    from lib.km_http import km_post  # noqa: PLC0415

    async def mock_post(url, *, content, headers, **kwargs):
        return _make_204_response()

    with patch("lib.km_http._client") as mock_client:
        mock_client.post = mock_post
        result = await km_post(
            "/api/folders/move",
            {"folderId": "f-1", "targetParentId": None},
            user_id="u1",
        )

    assert result == {"ok": True, "status": 204}


@pytest.mark.asyncio
async def test_km_patch_returns_ok_dict_on_204_no_content():
    """KM PATCH routes (e.g. /api/folders/{id} rename) return 204."""
    from lib.km_http import km_patch  # noqa: PLC0415

    async def mock_patch(url, *, content, headers, **kwargs):
        return _make_204_response()

    with patch("lib.km_http._client") as mock_client:
        mock_client.patch = mock_patch
        result = await km_patch(
            "/api/folders/abc", {"name": "new"}, user_id="u1",
        )

    assert result == {"ok": True, "status": 204}
