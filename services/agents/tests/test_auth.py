import hmac, hashlib, time, os
from fastapi.testclient import TestClient
import pytest

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from main import app  # noqa: E402

client = TestClient(app)


def sign(ts: str, method: str, path: str, body: bytes) -> str:
    msg = ts.encode() + method.encode() + path.encode() + body
    return hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()


def headers(ts: str, method: str, path: str, body: bytes = b""):
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-Document-Id": "1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sign(ts, method, path, body),
    }


def test_health_requires_internal_headers():
    r = client.get("/agents/health")
    assert r.status_code == 401


def test_health_accepts_valid_signature():
    ts = str(int(time.time()))
    r = client.get("/agents/health", headers=headers(ts, "GET", "/agents/health"))
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_rejects_stale_timestamp():
    ts = str(int(time.time()) - 120)  # 2 min old; limit is 60s
    r = client.get("/agents/health", headers=headers(ts, "GET", "/agents/health"))
    assert r.status_code == 401


def test_rejects_tampered_body():
    ts = str(int(time.time()))
    h = headers(ts, "POST", "/agents/health", b'{"a":1}')
    r = client.post("/agents/health", headers=h, content=b'{"a":2}')  # body mismatch
    assert r.status_code == 401
