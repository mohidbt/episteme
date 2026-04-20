import hmac, hashlib, time, os
from fastapi.testclient import TestClient

SECRET = os.environ.get("INHALE_INTERNAL_SECRET", "test-secret-abc")
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from main import app  # noqa: E402

client = TestClient(app)


def sign(ts: str, method: str, path: str, body: bytes = b"") -> str:
    msg = ts.encode() + method.encode() + path.encode() + body
    return hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()


def authed_headers(method: str = "GET", path: str = "/agents/health"):
    ts = str(int(time.time()))
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-Document-Id": "1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sign(ts, method, path),
    }


def test_health_returns_ok():
    r = client.get("/agents/health", headers=authed_headers())
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_unauthenticated_returns_401():
    r = client.get("/agents/health")
    assert r.status_code == 401
