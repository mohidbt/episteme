"""RED → GREEN test for /agents/km/extract 501 stub (Phase 1.4 T0).

The KM-side enrich route at apps/km/src/app/api/papersets/[id]/enrich/route.ts
already special-cases upstream 501 with a graceful SSE error event. Real
data-extract handler lands in 1.4.x T6; this stub closes the 404 gap.
"""
import hmac
import hashlib
import json
import os
import time

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


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


def test_extract_stub_requires_auth():
    """No auth headers → 401."""
    resp = client.post(
        "/agents/km/extract",
        json={"paperset_id": "x", "cells": [{"row_idx": 0, "col_name": "y"}]},
    )
    assert resp.status_code == 401


def test_extract_stub_returns_501_with_auth():
    """Valid auth → 501 with not_implemented JSON contract."""
    body = json.dumps(
        {"paperset_id": "x", "cells": [{"row_idx": 0, "col_name": "y"}]}
    ).encode()
    headers = _signed_headers("POST", "/agents/km/extract", body)
    resp = client.post("/agents/km/extract", content=body, headers=headers)
    assert resp.status_code == 501
    assert resp.json() == {
        "code": "not_implemented",
        "message": "data-extract skill ships in Phase 1.4.x",
    }
