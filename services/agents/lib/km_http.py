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
import os
import time

import httpx

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
    """GET from apps/km and return parsed JSON. Raises on non-2xx."""
    headers = _auth_headers("GET", path, b"", user_id)
    resp = await _client.get(_km_base_url() + path, headers=headers)
    resp.raise_for_status()
    return resp.json()


async def km_post(path: str, body: dict, *, user_id: str) -> object:
    """POST JSON to apps/km and return parsed JSON. Raises on non-2xx."""
    body_bytes = json.dumps(body).encode()
    headers = _auth_headers("POST", path, body_bytes, user_id)
    resp = await _client.post(_km_base_url() + path, content=body_bytes, headers=headers)
    resp.raise_for_status()
    return resp.json()


async def km_patch(path: str, body: dict, *, user_id: str) -> object:
    """PATCH JSON on apps/km and return parsed JSON. Raises on non-2xx."""
    body_bytes = json.dumps(body).encode()
    headers = _auth_headers("PATCH", path, body_bytes, user_id)
    resp = await _client.patch(_km_base_url() + path, content=body_bytes, headers=headers)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Reader (apps/reader) helpers
# ---------------------------------------------------------------------------


async def reader_get(path: str, *, user_id: str) -> object:
    """GET from apps/reader and return parsed JSON. Raises on non-2xx."""
    headers = _auth_headers("GET", path, b"", user_id)
    resp = await _reader_client.get(_reader_base_url() + path, headers=headers)
    resp.raise_for_status()
    return resp.json()


async def reader_post(path: str, body: dict, *, user_id: str) -> object:
    """POST JSON to apps/reader and return parsed JSON. Raises on non-2xx."""
    body_bytes = json.dumps(body).encode()
    headers = _auth_headers("POST", path, body_bytes, user_id)
    resp = await _reader_client.post(_reader_base_url() + path, content=body_bytes, headers=headers)
    resp.raise_for_status()
    return resp.json()
