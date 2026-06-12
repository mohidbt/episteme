"""Outbound HMAC client for km (Next.js) and reader (Next.js) apps.

Uses the same HMAC scheme as the inbound `require_internal` verifier:
    sig = HMAC-SHA256(secret, ts + method + path + body_bytes)

Headers sent on every request:
    X-Inhale-User-Id: <user_id>
    X-Inhale-Ts:      <unix timestamp string>
    X-Inhale-Sig:     <hex HMAC-SHA256>
    Content-Type:     application/json   (on POST/PATCH)
"""
import hashlib
import hmac
import json
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)


def _safe_response(resp: httpx.Response) -> object:
    """Convert a non-2xx httpx response into a tool-friendly error dict.

    Tools must never raise into the LangGraph stream — uncaught exceptions
    abort `astream_events`, leaving the tool card stuck on "Running" with
    no `on_tool_end` event ever emitted. Returning a structured error keeps
    the agent loop alive so the LLM can adapt or report the error.
    """
    body: object
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001 — body may be HTML / empty / non-JSON
        body = resp.text or None
    return {
        "error": True,
        "status": resp.status_code,
        "path": str(resp.request.url),
        "body": body,
    }


def _safe_request_error(exc: httpx.RequestError, *, method: str, url: str) -> object:
    """Map a transport-layer httpx error into a tool-friendly error dict."""
    logger.warning("km_http %s %s failed: %s", method, url, exc)
    return {
        "error": True,
        "status": None,
        "path": url,
        "body": f"{type(exc).__name__}: {exc}",
    }

def _km_base_url() -> str:
    return os.environ.get("EPISTEME_KM_BASE_URL", "http://localhost:3001")


def _reader_base_url() -> str:
    return os.environ.get("EPISTEME_READER_BASE_URL", "http://localhost:3000")


# Module-level clients; tests patch these directly.
_client = httpx.AsyncClient()
_reader_client = httpx.AsyncClient()


def _sign(method: str, path: str, body: bytes) -> tuple[str, str]:
    """Return (ts, sig) for an outbound request."""
    secret = os.environ["INHALE_INTERNAL_SECRET"]
    ts = str(int(time.time()))
    msg = ts.encode() + method.encode() + path.encode() + body
    sig = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return ts, sig


def _auth_headers(method: str, path: str, body: bytes, user_id: str) -> dict:
    ts, sig = _sign(method, path, body)
    return {
        "X-Inhale-User-Id": user_id,
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# KM (apps/km) helpers
# ---------------------------------------------------------------------------


async def km_get(path: str, *, user_id: str) -> object:
    """GET from apps/km and return parsed JSON, or a structured error dict on failure."""
    url = _km_base_url() + path
    headers = _auth_headers("GET", path, b"", user_id)
    try:
        resp = await _client.get(url, headers=headers)
    except httpx.RequestError as e:
        return _safe_request_error(e, method="GET", url=url)
    if resp.is_success:
        return resp.json()
    return _safe_response(resp)


def _decode_success(resp: httpx.Response) -> object:
    """Decode a 2xx httpx response body, tolerating 204/empty.

    KM write endpoints (folders/move, folders/trash, folders/{id} PATCH,
    folders/restore, folders/empty) return ``new NextResponse(null, { status: 204 })``;
    calling ``resp.json()`` on an empty body raises JSONDecodeError into the
    LangGraph stream (GSD-102 bug 2). Mirror km_delete's handling.
    """
    if resp.status_code == 204 or not getattr(resp, "content", b""):
        return {"ok": True, "status": resp.status_code}
    try:
        return resp.json()
    except Exception:  # noqa: BLE001 — non-JSON success body (rare)
        return {"ok": True, "status": resp.status_code}


async def km_post(path: str, body: dict, *, user_id: str) -> object:
    """POST JSON to apps/km and return parsed JSON, or a structured error dict on failure.

    On 204/empty success body, returns ``{"ok": True, "status": N}``.
    """
    body_bytes = json.dumps(body).encode()
    url = _km_base_url() + path
    headers = _auth_headers("POST", path, body_bytes, user_id)
    try:
        resp = await _client.post(url, content=body_bytes, headers=headers)
    except httpx.RequestError as e:
        return _safe_request_error(e, method="POST", url=url)
    if resp.is_success:
        return _decode_success(resp)
    return _safe_response(resp)


async def km_patch(path: str, body: dict, *, user_id: str) -> object:
    """PATCH JSON on apps/km and return parsed JSON, or a structured error dict on failure.

    On 204/empty success body, returns ``{"ok": True, "status": N}``.
    """
    body_bytes = json.dumps(body).encode()
    url = _km_base_url() + path
    headers = _auth_headers("PATCH", path, body_bytes, user_id)
    try:
        resp = await _client.patch(url, content=body_bytes, headers=headers)
    except httpx.RequestError as e:
        return _safe_request_error(e, method="PATCH", url=url)
    if resp.is_success:
        return _decode_success(resp)
    return _safe_response(resp)


async def km_delete(path: str, *, user_id: str) -> object:
    """DELETE against apps/km. Returns ``{"ok": True, "status": N}`` on 2xx
    (including 204), or a structured error dict on failure.
    """
    url = _km_base_url() + path
    headers = _auth_headers("DELETE", path, b"", user_id)
    try:
        resp = await _client.delete(url, headers=headers)
    except httpx.RequestError as e:
        return _safe_request_error(e, method="DELETE", url=url)
    if resp.is_success:
        if resp.status_code == 204 or not resp.content:
            return {"ok": True, "status": resp.status_code}
        try:
            return resp.json()
        except Exception:  # noqa: BLE001
            return {"ok": True, "status": resp.status_code}
    return _safe_response(resp)


# ---------------------------------------------------------------------------
# Reader (apps/reader) helpers
# ---------------------------------------------------------------------------


async def reader_get(path: str, *, user_id: str) -> object:
    """GET from apps/reader and return parsed JSON, or a structured error dict on failure."""
    url = _reader_base_url() + path
    headers = _auth_headers("GET", path, b"", user_id)
    try:
        resp = await _reader_client.get(url, headers=headers)
    except httpx.RequestError as e:
        return _safe_request_error(e, method="GET", url=url)
    if resp.is_success:
        return resp.json()
    return _safe_response(resp)


async def reader_post(path: str, body: dict, *, user_id: str) -> object:
    """POST JSON to apps/reader and return parsed JSON, or a structured error dict on failure."""
    body_bytes = json.dumps(body).encode()
    url = _reader_base_url() + path
    headers = _auth_headers("POST", path, body_bytes, user_id)
    try:
        resp = await _reader_client.post(url, content=body_bytes, headers=headers)
    except httpx.RequestError as e:
        return _safe_request_error(e, method="POST", url=url)
    if resp.is_success:
        return resp.json()
    return _safe_response(resp)
