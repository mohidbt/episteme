import hmac, hashlib, json, os, time
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

import deps.db  # noqa: E402
from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)

PAPER_ID = "11111111-1111-1111-1111-111111111111"


def _signed_headers(method: str, path: str):
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + b"",
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
    }


def _make_row(id=1, paper_id=PAPER_ID, idx=0, title="Intro", content="preview", ps=1, pe=1):
    """Simulate an asyncpg Record as a dict-like object."""
    created = datetime(2026, 4, 16, tzinfo=timezone.utc)
    return {
        "id": id, "paper_id": paper_id, "section_index": idx,
        "title": title, "content": content, "page_start": ps, "page_end": pe,
        "created_at": created,
    }


def test_outline_returns_cached_sections():
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = [_make_row(), _make_row(id=2, idx=1, title="Methods", ps=3, pe=5)]

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        path = f"/agents/outline?paperId={PAPER_ID}"
        r = client.get(path, headers=_signed_headers("GET", path))
        assert r.status_code == 200
        data = r.json()
        assert len(data["sections"]) == 2
        s = data["sections"][0]
        assert s["paperId"] == PAPER_ID
        assert s["sectionIndex"] == 0
        assert s["title"] == "Intro"
        assert s["pageStart"] == 1
        assert s["createdAt"].startswith("2026-04-16")
        # DB should NOT have been called for insert
        mock_conn.fetchrow.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_outline_generates_via_llm():
    mock_conn = AsyncMock()
    # First call: fetch cached sections -> empty
    mock_conn.fetch.return_value = []
    # Second call: fetchrow for paper -> found
    paper_row = {"storage_url": "/tmp/test.pdf"}
    insert_row = _make_row()

    async def fetchrow_side_effect(query, *args):
        if "FROM papers" in query:
            return paper_row
        if "INSERT INTO document_sections" in query:
            return insert_row
        return None

    mock_conn.fetchrow.side_effect = fetchrow_side_effect

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    llm_response = json.dumps([
        {"title": "Introduction", "page": 1, "preview": "This paper..."},
        {"title": "Methods", "page": 5, "preview": "We used..."},
    ])
    fake_pages = [{"page_number": 1, "text": "Hello world"}]

    try:
        with (
            patch("routers.outline.call_model", return_value=llm_response) as mock_call,
            patch("routers.outline.extract_pages", return_value=fake_pages),
        ):
            path = f"/agents/outline?paperId={PAPER_ID}"
            r = client.get(path, headers=_signed_headers("GET", path))
            assert r.status_code == 200
            data = r.json()
            assert len(data["sections"]) == 2
            mock_call.assert_called_once()
            # Verify INSERT was called twice (one per valid section)
            assert mock_conn.fetchrow.call_count == 3  # 1 paper lookup + 2 inserts
    finally:
        app.dependency_overrides.clear()


def test_outline_404_when_paper_not_found():
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []
    mock_conn.fetchrow.return_value = None  # paper not found

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        missing = "22222222-2222-2222-2222-222222222222"
        path = f"/agents/outline?paperId={missing}"
        r = client.get(path, headers=_signed_headers("GET", path))
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_outline_unauthenticated():
    r = client.get(f"/agents/outline?paperId={PAPER_ID}")
    assert r.status_code == 401
