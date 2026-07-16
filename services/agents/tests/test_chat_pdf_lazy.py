"""GSD-135 twin: chat must download source.pdf LAZILY.

The chat highlight tools (`page_text`/`locate_phrase`) open the PDF with
pypdf/pdfplumber, which need a real local path. `paper.storage_url` is an R2
object key, not a local file — in serverless there is no shared filesystem.

The seam: chat passes an async PDF provider into build_tools that downloads to
a tempfile ON FIRST highlight-tool call. The common no-highlight chat path must
NOT download anything. A missing object mid-highlight must surface gracefully
(SSE error), never a 500.
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
from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from lib.rag import ChunkRow, RetrievalResult  # noqa: E402

client = TestClient(app)

PAPER_ID = "00000000-0000-0000-0000-000000000001"
STORAGE_KEY = f"{PAPER_ID}/source.pdf"
FIXTURE = str(Path(__file__).resolve().parents[3] / "apps/km/e2e/fixtures/reader-test.pdf")


def _signed_headers(method: str, path: str, body: bytes):
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-Paper-Id": PAPER_ID,
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def _parse_sse(text: str) -> list:
    events = []
    for line in text.split("\n"):
        if line.startswith("data: "):
            payload = line[6:]
            events.append("[DONE]" if payload == "[DONE]" else json.loads(payload))
    return events


def _mock_conn():
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "id": 1,
        "chandra_status": "done",
        "storage_url": STORAGE_KEY,
    }
    conn.execute.return_value = None
    conn.fetchval.return_value = 0
    return conn


_RETRIEVAL = RetrievalResult(
    supporting_chunks=[ChunkRow(1, "Some content", 1, 1, 0.85)],
    page_text=None,
    anchor_text=None,
    sources=[{"page": 1, "relevance": 0.85}],
)


def test_no_highlight_chat_does_not_download_pdf():
    """A plain Q&A turn (no highlight tool fired) must NOT download source.pdf."""
    conn = _mock_conn()

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override

    download_calls = {"n": 0}

    @asynccontextmanager
    async def spy_download(key, suffix=".pdf"):
        download_calls["n"] += 1
        yield FIXTURE

    async def fake_run_chat(**kwargs):
        # Pure prose answer: no highlight tool ever invoked.
        yield ("token", "It is a paper.")

    try:
        with (
            patch("routers.chat.retrieve", return_value=_RETRIEVAL),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
            patch("lib.storage.download_to_tempfile", spy_download),
        ):
            body = json.dumps({"question": "What is this?"}).encode()
            r = client.post(
                "/agents/chat", content=body,
                headers=_signed_headers("POST", "/agents/chat", body),
            )
            assert r.status_code == 200
            events = _parse_sse(r.text)
            assert events[-1] == "[DONE]"
    finally:
        app.dependency_overrides.clear()

    assert download_calls["n"] == 0, "no-highlight chat must not download source.pdf"


def test_highlight_chat_downloads_and_reads_local_tempfile():
    """When the agent invokes a PDF-reading highlight tool, chat downloads
    source.pdf once and the tool reads from the LOCAL tempfile path.
    """
    conn = _mock_conn()

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override

    download_calls = {"n": 0}

    @asynccontextmanager
    async def spy_download(key, suffix=".pdf"):
        assert key == STORAGE_KEY
        download_calls["n"] += 1
        yield FIXTURE

    captured = {}

    async def fake_run_chat(**kwargs):
        # Drive the real page_text tool that chat built.
        tools = kwargs["tools"]
        page_text = next(t for t in tools if t.name == "page_text")
        result = await page_text.ainvoke({"page_number": 1})
        captured["page_text"] = result
        yield ("token", "done")

    try:
        with (
            patch("routers.chat.retrieve", return_value=_RETRIEVAL),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
            patch("lib.storage.download_to_tempfile", spy_download),
        ):
            body = json.dumps({"question": "highlight the intro"}).encode()
            r = client.post(
                "/agents/chat", content=body,
                headers=_signed_headers("POST", "/agents/chat", body),
            )
            assert r.status_code == 200
            _ = r.text
    finally:
        app.dependency_overrides.clear()

    assert download_calls["n"] == 1, "highlight tool must trigger exactly one download"
    assert captured["page_text"]["page"] == 1
    assert "Test PDF Document" in captured["page_text"]["text"]


def test_highlight_chat_missing_pdf_streams_error_no_500():
    """If source.pdf is gone when a highlight tool fires, the run must surface
    a graceful SSE error mid-stream, never a 500 / unhandled crash.
    """
    conn = _mock_conn()

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override

    @asynccontextmanager
    async def missing_download(key, suffix=".pdf"):
        raise storage.SourcePdfMissing(key)
        yield  # pragma: no cover

    async def fake_run_chat(**kwargs):
        tools = kwargs["tools"]
        page_text = next(t for t in tools if t.name == "page_text")
        # Tool fires → provider downloads → SourcePdfMissing propagates.
        await page_text.ainvoke({"page_number": 1})
        yield ("token", "unreachable")

    try:
        with (
            patch("routers.chat.retrieve", return_value=_RETRIEVAL),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
            patch("lib.storage.download_to_tempfile", missing_download),
        ):
            body = json.dumps({"question": "highlight the intro"}).encode()
            r = client.post(
                "/agents/chat", content=body,
                headers=_signed_headers("POST", "/agents/chat", body),
            )
            assert r.status_code == 200, r.text
            events = _parse_sse(r.text)
            errors = [e for e in events if isinstance(e, dict) and e.get("type") == "error"]
            assert errors, f"expected an SSE error event, got {events}"
            assert events[-1] == "[DONE]"
    finally:
        app.dependency_overrides.clear()
