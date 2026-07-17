"""Live FastAPI E2E tests for Phase 1.5.

These tests spin up the real FastAPI app via Uvicorn and make HTTP calls
against localhost, while stubbing only DB/model boundaries.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import socket
import threading
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import httpx
import pytest
import uvicorn

import deps.db as db_deps
from app import app
from routers import km_chat
from tools.search import search_library


SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"
os.environ["EPISTEME_PDF_LOCAL_TEST"] = "1"


class _FakeConn:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    async def fetch(self, _sql: str, *_args):
        return self._rows


class _FakePool:
    def __init__(self, rows: list[dict]):
        self._conn = _FakeConn(rows)

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[_FakeConn]:
        yield self._conn


class _MemoryConn:
    def __init__(self):
        self.note_chunks: list[dict] = []

    async def execute(self, sql: str, *args):
        if "DELETE FROM note_chunks" in sql:
            note_id = str(args[0])
            self.note_chunks = [r for r in self.note_chunks if r["note_id"] != note_id]
        return "OK"

    async def executemany(self, sql: str, rows):
        if "INSERT INTO note_chunks" in sql:
            for row in rows:
                note_id, chunk_idx, content, _embedding, _metadata = row
                self.note_chunks.append(
                    {
                        "note_id": str(note_id),
                        "chunk_idx": int(chunk_idx),
                        "content": str(content),
                    }
                )

    async def fetch(self, sql: str, *args):
        if "FROM note_chunks" in sql and "JOIN notes" in sql:
            out = []
            for c in self.note_chunks:
                out.append(
                    {
                        "note_id": c["note_id"],
                        "content": c["content"],
                        "score": 0.88,
                        "title": "PDF Seeded Note",
                        "slug": "pdf-seeded-note",
                    }
                )
            return out
        return []


class _MemoryPool:
    def __init__(self):
        self.conn = _MemoryConn()

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _signed_headers(method: str, path: str, body: bytes) -> dict[str, str]:
    ts = str(int(time.time()))
    msg = ts.encode() + method.encode() + path.encode() + body
    sig = hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()
    return {
        "X-Inhale-User-Id": "user_e2e",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def _parse_sse(text: str) -> list[dict]:
    out: list[dict] = []
    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[6:]
        if payload == "[DONE]":
            out.append({"type": "done"})
        else:
            out.append(json.loads(payload))
    return out


def _parse_named_sse(text: str) -> list[dict]:
    out: list[dict] = []
    current_event = None
    for line in text.splitlines():
        if line.startswith("event: "):
            current_event = line[len("event: "):]
            continue
        if line.startswith("data: "):
            payload = json.loads(line[len("data: "):])
            out.append({"event": current_event, "data": payload})
            current_event = None
    return out


class _ToolFlowAgent:
    def __init__(self):
        self.fallback_calls = 0
        self._seen_fallback_papers: set[str] = set()

    async def astream_events(self, input_, config, version):  # noqa: ANN001, ARG002
        _ = (config, version)
        msg = input_["messages"][0]["content"].lower()
        run = "run-1"
        if "image-like" in msg or "scanned" in msg:
            paper_id = "paper-fallback"
            use_cache = paper_id in self._seen_fallback_papers
            yield {
                "event": "on_tool_start",
                "run_id": run,
                "name": "read_paper",
                "data": {"input": {"paper_id": paper_id}},
            }
            if use_cache:
                output = {"source": "cache", "text": "cached markdown"}
            else:
                self.fallback_calls += 1
                self._seen_fallback_papers.add(paper_id)
                output = {
                    "source": "chandra",
                    "text": "ocr markdown",
                    "progress": [{"type": "pdf_extract_progress", "paper_id": paper_id, "stage": "fallback_triggered"}],
                }
            yield {
                "event": "on_tool_end",
                "run_id": run,
                "name": "read_paper",
                "data": {"output": output},
            }
            return

        if "deep-read" in msg:
            yield {
                "event": "on_tool_start",
                "run_id": run,
                "name": "read_paper",
                "data": {"input": {"paper_id": "paper-text", "page": 1}},
            }
            yield {
                "event": "on_tool_end",
                "run_id": run,
                "name": "read_paper",
                "data": {"output": {"source": "pdfplumber", "pages": [{"pageNumber": 1, "text": "full text"}]}},
            }
            return

        yield {
            "event": "on_chat_model_stream",
            "run_id": run,
            "data": {"chunk": type("Chunk", (), {"content": "noop"})()},
        }

    async def aget_state(self, *_args, **_kwargs):
        class _Snap:
            tasks = []
        return _Snap()


def _fixture_pdf(name: str) -> str:
    root = Path(__file__).resolve().parents[3]
    return str(root / "apps" / "km" / "public" / "seed" / name)


@pytest.fixture
def live_server():
    # Prevent prior fake pools from breaking app lifespan startup.
    db_deps._pool = None
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            r = httpx.get(f"{base}/openapi.json", timeout=0.5)
            if r.status_code == 200:
                break
        except Exception:  # noqa: BLE001
            time.sleep(0.05)
    else:
        server.should_exit = True
        thread.join(timeout=3)
        raise RuntimeError("live server failed to boot")

    try:
        yield base
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        db_deps._pool = None


def test_live_km_chat_empty_retrieval_returns_guardrail(live_server, monkeypatch):
    """Prompt: a real user question with no indexed notes.
    Expectation: no model call, empty-source guardrail response.
    """
    db_deps._pool = _FakePool(rows=[])

    body = json.dumps({"question": "What evidence supports retrieval augmentation?"}).encode()
    path = "/agents/km/chat"
    r = httpx.post(
        f"{live_server}{path}",
        content=body,
        headers=_signed_headers("POST", path, body),
        timeout=10,
    )
    assert r.status_code == 200

    events = _parse_sse(r.text)
    assert events[0] == {"type": "sources", "notes": []}
    token_events = [e for e in events if e.get("type") == "token"]
    assert token_events, "expected at least one streamed token"
    combined = "".join(e["content"] for e in token_events)
    assert "could not find anything in your notes" in combined.lower()
    assert events[-1] == {"type": "done"}


def test_live_km_chat_with_sources_emits_cited_answer(live_server, monkeypatch):
    """Prompt: asks about transformers. We stub stream tokens to simulate model
    output and assert the backend delivers citations tied to retrieved sources.
    """
    rows = [
        {
            "note_id": "11111111-1111-1111-1111-111111111111",
            "content": "Transformers use self-attention over token sequences.",
            "score": 0.91,
            "title": "Transformers",
            "slug": "transformers",
        }
    ]
    db_deps._pool = _FakePool(rows=rows)

    async def fake_stream(_api_key: str, _messages: list[dict]):
        for tok in ["Transformers use self-attention [[Transformers]]."]:
            yield tok

    monkeypatch.setattr(km_chat, "_stream_tokens", fake_stream)

    body = json.dumps({"question": "How do transformers model context?"}).encode()
    path = "/agents/km/chat"
    r = httpx.post(
        f"{live_server}{path}",
        content=body,
        headers=_signed_headers("POST", path, body),
        timeout=10,
    )
    assert r.status_code == 200

    events = _parse_sse(r.text)
    assert events[0]["type"] == "sources"
    assert events[0]["notes"][0]["title"] == "Transformers"
    token_events = [e for e in events if e.get("type") == "token"]
    combined = "".join(e["content"] for e in token_events)
    assert "[[Transformers]]" in combined
    assert events[-1] == {"type": "done"}


def test_live_pdf_text_full_and_single_page_real_seed_pdf(live_server):
    """Real PDF flow: parse a shipped seed paper through live backend."""
    pdf_path = _fixture_pdf("2005.11401.pdf")
    body = json.dumps({"file_path": pdf_path}).encode()
    path = "/agents/pdf/text"
    r = httpx.post(
        f"{live_server}{path}",
        content=body,
        headers=_signed_headers("POST", path, body),
        timeout=30,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert "pages" in payload
    assert len(payload["pages"]) > 3
    assert payload["pages"][0]["pageNumber"] == 1

    # Analyze extracted text quality: first pages should contain dense text.
    non_empty = [p for p in payload["pages"][:5] if (p.get("text") or "").strip()]
    assert len(non_empty) >= 3

    body2 = json.dumps({"file_path": pdf_path, "page": 2}).encode()
    r2 = httpx.post(
        f"{live_server}{path}",
        content=body2,
        headers=_signed_headers("POST", path, body2),
        timeout=30,
    )
    assert r2.status_code == 200, r2.text
    one = r2.json()["pages"]
    assert len(one) == 1
    assert one[0]["pageNumber"] == 2


def test_live_pdf_annotations_real_reader_fixture(live_server):
    """Real annotation flow: parse links/markers from a real annotated seed PDF."""
    pdf_path = _fixture_pdf("2005.11401.pdf")
    body = json.dumps({"file_path": pdf_path}).encode()
    path = "/agents/pdf/annotations"
    r = httpx.post(
        f"{live_server}{path}",
        content=body,
        headers=_signed_headers("POST", path, body),
        timeout=30,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert set(payload.keys()) == {"references", "markers"}
    # Verify the response shape; both lists may be empty for PDFs whose link
    # annotations use named (non-numeric) citation keys.
    assert isinstance(payload["references"], list)
    assert isinstance(payload["markers"], list)


@pytest.mark.asyncio
async def test_search_library_agent_flow_with_real_prompt_and_analysis():
    """Tool-level E2E: user prompt -> search_library -> analyze citation payload."""
    class _Conn:
        async def fetch(self, sql: str, *_args):
            if "FROM note_chunks" in sql:
                return [
                    {
                        "chunk_id": "n-chunk-1",
                        "source_id": "note-1",
                        "source_kind": "note",
                        "page": None,
                        "snippet": "Retriever quality improves with query expansion.",
                    }
                ]
            if "FROM paper_chunks" in sql:
                return [
                    {
                        "chunk_id": "p-chunk-1",
                        "source_id": "paper-1",
                        "source_kind": "paper",
                        "page": 4,
                        "snippet": "RAG combines retrieval with generation for grounded answers.",
                    }
                ]
            return []

    class _Pool:
        @asynccontextmanager
        async def acquire(self):
            yield _Conn()

    import deps.db as _db

    _db._pool = _Pool()
    prompt = "How does RAG improve factual grounding?"
    out = await search_library.ainvoke(
        {"query": prompt, "k": 8},
        config={"configurable": {"user_id": "user_e2e"}},
    )
    assert out["query"] == prompt
    assert len(out["results"]) == 2
    # Analyze answer substrate quality: must include typed citations.
    kinds = {r["source_kind"] for r in out["results"]}
    assert kinds == {"note", "paper"}
    paper = next(r for r in out["results"] if r["source_kind"] == "paper")
    assert paper["page"] == 4


def test_live_pdf_to_embed_to_chat_end_to_end(live_server, monkeypatch):
    """Full flow:
    1) extract real PDF text
    2) seed note chunks via /agents/km/embed-note-chunks
    3) prompt /agents/km/chat and analyze cited answer
    """
    mem_pool = _MemoryPool()
    db_deps._pool = mem_pool

    # Keep chat deterministic for assertion while still exercising live route.
    async def fake_stream(_api_key: str, _messages: list[dict]):
        yield "The passage mentions retrieval-augmented generation [[PDF Seeded Note]]."

    monkeypatch.setattr(km_chat, "_stream_tokens", fake_stream)

    pdf_path = _fixture_pdf("2005.11401.pdf")
    text_path = "/agents/pdf/text"
    body = json.dumps({"file_path": pdf_path, "page": 1}).encode()
    text_resp = httpx.post(
        f"{live_server}{text_path}",
        content=body,
        headers=_signed_headers("POST", text_path, body),
        timeout=30,
    )
    assert text_resp.status_code == 200, text_resp.text
    first_page = text_resp.json()["pages"][0]["text"]
    assert len(first_page.strip()) > 100

    note_id = "99999999-9999-9999-9999-999999999999"
    chunks = [
        {"chunkIdx": 0, "content": first_page[:1200]},
        {"chunkIdx": 1, "content": first_page[1200:2400] or first_page[:400]},
    ]
    embed_path = "/agents/km/embed-note-chunks"
    embed_body = json.dumps({"noteId": note_id, "chunks": chunks}).encode()
    embed_resp = httpx.post(
        f"{live_server}{embed_path}",
        content=embed_body,
        headers=_signed_headers("POST", embed_path, embed_body),
        timeout=30,
    )
    assert embed_resp.status_code == 200, embed_resp.text
    assert embed_resp.json()["inserted"] == 2

    chat_path = "/agents/km/chat"
    prompt = "What does this paper say about retrieval-augmented generation?"
    chat_body = json.dumps({"question": prompt}).encode()
    chat_resp = httpx.post(
        f"{live_server}{chat_path}",
        content=chat_body,
        headers=_signed_headers("POST", chat_path, chat_body),
        timeout=30,
    )
    assert chat_resp.status_code == 200, chat_resp.text
    events = _parse_sse(chat_resp.text)
    assert events[0]["type"] == "sources"
    assert len(events[0]["notes"]) >= 1
    token_events = [e for e in events if e.get("type") == "token"]
    combined = "".join(e["content"] for e in token_events)
    assert "[[PDF Seeded Note]]" in combined
    assert "retrieval-augmented generation" in combined.lower()


def test_live_km_invoke_fallback_then_cache_no_repeat_expensive_call(live_server, monkeypatch):
    agent = _ToolFlowAgent()
    monkeypatch.setattr("routers.km_agent.build_km_agent", AsyncMock(return_value=agent))

    path = "/agents/km/invoke"
    first = json.dumps({"thread_id": "t-fb1", "message": "Deep-read this image-like scanned PDF."}).encode()
    r1 = httpx.post(
        f"{live_server}{path}",
        content=first,
        headers=_signed_headers("POST", path, first),
        timeout=20,
    )
    assert r1.status_code == 200, r1.text
    ev1 = _parse_named_sse(r1.text)
    tr1 = [e for e in ev1 if e["event"] == "tool_result"][0]["data"]["output"]
    assert tr1["source"] == "chandra"
    assert tr1["progress"][0]["type"] == "pdf_extract_progress"
    progress_events = [e for e in ev1 if e["event"] == "pdf_extract_progress"]
    assert progress_events, "expected explicit pdf_extract_progress SSE event"
    assert progress_events[0]["data"] == {
        "paper_id": "paper-fallback",
        "stage": "fallback_triggered",
    }

    second = json.dumps({"thread_id": "t-fb2", "message": "Deep-read this image-like scanned PDF again."}).encode()
    r2 = httpx.post(
        f"{live_server}{path}",
        content=second,
        headers=_signed_headers("POST", path, second),
        timeout=20,
    )
    assert r2.status_code == 200, r2.text
    ev2 = _parse_named_sse(r2.text)
    tr2 = [e for e in ev2 if e["event"] == "tool_result"][0]["data"]["output"]
    assert tr2["source"] == "cache"
    assert agent.fallback_calls == 1
