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
from pathlib import Path
from unittest.mock import AsyncMock

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from lib.auto_highlight_tools import is_stale_rect  # noqa: E402
from main import app  # noqa: E402

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
        "X-Inhale-Document-Id": "1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def test_rebuild_replaces_sliver_with_clean_rect():
    """Seed a sliver rect, hit /rebuild, assert the UPDATE carries a clean rect."""
    conn = AsyncMock()

    async def fetchrow(query, *args):
        # SELECT run + file_path
        if "AI_HIGHLIGHT_RUNS" in query.upper():
            return {"id": RUN_ID, "file_path": str(FIXTURE)}
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
