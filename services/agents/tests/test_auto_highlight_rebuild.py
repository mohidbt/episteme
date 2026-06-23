"""Integration test for the rebuild endpoint (Phase 2.1.2 Task 52).

Seeds a fake run row whose highlight has a sliver rect for "chemosensory"
on fixture page 1, calls the rebuild handler, and asserts the UPDATE'd
rect passes `is_stale_rect=False` AND has width >= 5pt.

The DB boundary is asyncpg's `fetchrow`/`fetch`/`execute` — mocked via
FastAPI dependency override, mirroring `test_auto_highlight_route.py`.
"""

import hashlib
import hmac
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
import lib.storage as storage  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from lib.auto_highlight_tools import is_stale_rect  # noqa: E402
from app import app  # noqa: E402

client = TestClient(app)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "chemosensory.pdf"
RUN_ID = "11111111-1111-1111-1111-111111111111"
HIGHLIGHT_ID = 7
PATH = f"/agents/auto-highlight/runs/{RUN_ID}/rebuild"


def _signed_headers(method: str, path: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-Paper-Id": "00000000-0000-0000-0000-000000000001",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


@asynccontextmanager
async def _fake_download(key, suffix=".pdf"):
    """Stand-in for download_to_tempfile: yield the fixture path without S3.

    GSD-135 twin: rebuild now downloads source.pdf to a local tempfile before
    reading it (the stored storage_url is an R2 key, not a local path).
    """
    yield str(FIXTURE)


def test_rebuild_replaces_sliver_with_clean_rect():
    """Seed a sliver rect, hit /rebuild, assert the UPDATE carries a clean rect."""
    storage_key = f"{RUN_ID}/source.pdf"
    conn = AsyncMock()

    async def fetchrow(query, *args):
        # SELECT run + storage_url
        if "AI_HIGHLIGHT_RUNS" in query.upper():
            return {"id": RUN_ID, "storage_url": storage_key}
        return None

    async def fetch(query, *args):
        # SELECT user_highlights for this run. start_offset=0 so _find_exact
        # just picks the first "chemosensory" hit on page 1.
        if "USER_HIGHLIGHTS" in query.upper():
            return [
                {
                    "id": HIGHLIGHT_ID,
                    "page_number": 1,
                    "text_content": "chemosensory",
                    "start_offset": 0,
                }
            ]
        return []

    update_calls: list[tuple] = []

    async def execute(query, *args):
        if "UPDATE" in query.upper():
            update_calls.append(args)
        return None

    conn.fetchrow.side_effect = fetchrow
    conn.fetch.side_effect = fetch
    conn.execute.side_effect = execute

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        with patch("routers.auto_highlight_rebuild.download_to_tempfile", _fake_download):
            body = b""
            r = client.post(PATH, content=body, headers=_signed_headers("POST", PATH, body))
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["updated"] == 1, data
            assert data["skipped"] == 0, data

            # The UPDATE query carries the new rects payload as its first arg.
            assert update_calls, "expected at least one UPDATE"
            rects_json = update_calls[0][0]
            rects = json.loads(rects_json)
            assert rects, "rebuild produced no rects"
            r0 = rects[0]
            # Clean rect: not a sliver, and has width >= ~5pt.
            assert is_stale_rect(r0) is False, r0
            assert (r0["x1"] - r0["x0"]) >= 5.0, r0
    finally:
        app.dependency_overrides.clear()


def test_rebuild_missing_source_pdf_returns_404():
    """GSD-135 twin: storage_url is an R2 key. If the object is gone, the
    rebuild route must download it, hit SourcePdfMissing, and surface a
    structured 404 instead of letting FileNotFoundError 500 in serverless.
    """
    storage_key = f"{RUN_ID}/source.pdf"
    conn = AsyncMock()

    async def fetchrow(query, *args):
        if "AI_HIGHLIGHT_RUNS" in query.upper():
            return {"id": RUN_ID, "storage_url": storage_key}
        return None

    async def fetch(query, *args):
        if "USER_HIGHLIGHTS" in query.upper():
            return [
                {
                    "id": HIGHLIGHT_ID,
                    "page_number": 1,
                    "text_content": "chemosensory",
                    "start_offset": 0,
                }
            ]
        return []

    conn.fetchrow.side_effect = fetchrow
    conn.fetch.side_effect = fetch
    conn.execute.return_value = None

    @asynccontextmanager
    async def missing_download(key, suffix=".pdf"):
        raise storage.SourcePdfMissing(key)
        yield  # pragma: no cover

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        with patch(
            "routers.auto_highlight_rebuild.download_to_tempfile", missing_download
        ):
            body = b""
            r = client.post(PATH, content=body, headers=_signed_headers("POST", PATH, body))
            assert r.status_code == 404, r.text
            assert r.json() == {"detail": "source_pdf_missing"}
    finally:
        app.dependency_overrides.clear()
