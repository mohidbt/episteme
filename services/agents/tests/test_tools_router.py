"""RED tests for GET /agents/km/tools live tool inventory (GSD-33)."""
import hashlib
import hmac
import os
import time

from fastapi.testclient import TestClient

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402

client = TestClient(app)

PATH = "/agents/km/tools"


def _sign(ts: str, method: str, path: str, body: bytes) -> str:
    msg = ts.encode() + method.encode() + path.encode() + body
    return hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()


def _headers(ts: str | None = None, method: str = "GET", path: str = PATH, body: bytes = b""):
    ts = ts or str(int(time.time()))
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": _sign(ts, method, path, body),
    }


def test_tools_endpoint_returns_all_tools():
    from tools import ALL_TOOLS  # noqa: PLC0415

    r = client.get(PATH, headers=_headers())
    assert r.status_code == 200
    payload = r.json()
    assert "tools" in payload
    assert len(payload["tools"]) == len(ALL_TOOLS)
    for entry in payload["tools"]:
        assert set(entry.keys()) >= {
            "name", "description", "category", "gateable", "default_allowed",
        }
        assert entry["gateable"] is True
        assert entry["default_allowed"] is True
        assert isinstance(entry["name"], str) and entry["name"]
        assert isinstance(entry["description"], str)
        assert isinstance(entry["category"], str)


def test_tools_endpoint_requires_hmac_auth():
    r = client.get(PATH)  # no headers
    assert r.status_code in (401, 403)


def test_tools_endpoint_categories_map_known_modules():
    r = client.get(PATH, headers=_headers())
    assert r.status_code == 200
    by_name = {t["name"]: t["category"] for t in r.json()["tools"]}
    assert by_name.get("web_search") == "web"
    assert by_name.get("create_note") == "notes"
    # read_paper lives in tools/papers.py → "papers" category (find_papers,
    # highlight, pdf_explain_passage are in tools/pdfs.py → "pdfs"). Both
    # categories surface in the UI; mapping reflects actual module ownership.
    assert by_name.get("read_paper") == "papers"
    assert by_name.get("find_papers") == "pdfs"
    assert by_name.get("agentic_search_papers") == "paper_search"


def test_tools_endpoint_response_is_stable_across_calls():
    """Two sequential GETs return identical payloads — no per-request mutation."""
    r1 = client.get(PATH, headers=_headers())
    r2 = client.get(PATH, headers=_headers())
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Compare by sorted name list — content equivalence
    n1 = sorted(t["name"] for t in r1.json()["tools"])
    n2 = sorted(t["name"] for t in r2.json()["tools"])
    assert n1 == n2
