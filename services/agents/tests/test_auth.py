import hashlib
import hmac
import os
import time
from fastapi.testclient import TestClient

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402

client = TestClient(app)


def sign(ts: str, method: str, path: str, body: bytes) -> str:
    from deps.auth import canonical_signature_message

    msg = canonical_signature_message(
        ts=ts,
        method=method,
        path=path,
        user_id="user_1",
        paper_id="00000000-0000-0000-0000-000000000001",
        llm_key="sk-test",
        body=body,
    )
    return hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()


def headers(ts: str, method: str, path: str, body: bytes = b""):
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-Paper-Id": "00000000-0000-0000-0000-000000000001",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sign(ts, method, path, body),
        "X-Inhale-Sig-Version": "2",
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


def test_rejects_tampered_tenant_and_llm_headers():
    ts = str(int(time.time()))
    original = headers(ts, "GET", "/agents/health")
    for name, value in (
        ("X-Inhale-User-Id", "attacker"),
        ("X-Inhale-Paper-Id", "00000000-0000-0000-0000-000000000099"),
        ("X-Inhale-LLM-Key", "attacker-key"),
    ):
        tampered = {**original, name: value}
        response = client.get("/agents/health", headers=tampered)
        assert response.status_code == 401, name


def test_accepts_query_string_signature():
    """Inbound verifier must sign path INCLUDING query string, matching the
    outbound signer in lib/km_http.py and the Next.js verifiers."""
    ts = str(int(time.time()))
    path_with_query = "/agents/health?foo=bar&baz=1"
    r = client.get(path_with_query, headers=headers(ts, "GET", path_with_query))
    assert r.status_code == 200


def test_rejects_future_skew_timestamp():
    ts = str(int(time.time()) + 120)  # 2 min ahead; limit is 60s
    r = client.get("/agents/health", headers=headers(ts, "GET", "/agents/health"))
    assert r.status_code == 401


def test_golden_hmac_vector_matches_outbound_signer():
    """Cross-language golden vector. The matching assertions live in
    apps/km/src/lib/internal-auth.test.ts and
    apps/reader/src/lib/__tests__/internal-auth.test.ts. All three sides must
    agree byte-for-byte. Computed once via:
        hmac.new(b"test-secret",
                 b"1700000000POST/api/notes?q=foo{\"title\":\"hi\"}",
                 hashlib.sha256).hexdigest()
    """
    expected = "f4e7e1e37132dbfe7fcd6bf877083d98ec9185b501a4e5b759bf2f4ac22c5e79"
    from deps.auth import canonical_signature_message

    msg = canonical_signature_message(
        ts="1700000000",
        method="POST",
        path="/api/notes?q=foo",
        user_id="u1",
        paper_id="p1",
        llm_key="llm",
        ocr_key="ocr",
        body=b'{"title":"hi"}',
    )
    assert hmac.new(b"test-secret", msg, hashlib.sha256).hexdigest() == expected

    # Also verify km_http.py's _sign produces the same bytes for the same
    # inputs (frozen ts). _sign builds: ts + method + path + body, identical
    # to what we computed above; importing here proves the module loads and
    # confirms its message construction hasn't drifted.
    import os as _os
    from lib import km_http  # noqa: F401

    prev_secret = _os.environ.get("INHALE_INTERNAL_SECRET")
    _os.environ["INHALE_INTERNAL_SECRET"] = "test-secret"
    try:
        # Monkey-patch time.time to freeze the ts inside _sign.
        import time as _time

        original_time = _time.time
        _time.time = lambda: 1700000000  # type: ignore[assignment]
        try:
            ts_signed, sig_signed = km_http._sign(
                "POST",
                "/api/notes?q=foo",
                b'{"title":"hi"}',
                user_id="u1",
                paper_id="p1",
                llm_key="llm",
                ocr_key="ocr",
            )
        finally:
            _time.time = original_time
        assert ts_signed == "1700000000"
        assert sig_signed == expected
    finally:
        if prev_secret is None:
            del _os.environ["INHALE_INTERNAL_SECRET"]
        else:
            _os.environ["INHALE_INTERNAL_SECRET"] = prev_secret
