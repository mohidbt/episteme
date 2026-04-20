import hmac, hashlib, json, os, time
from unittest.mock import AsyncMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from lib.rag import RetrievalResult, ChunkRow  # noqa: E402

client = TestClient(app)


def _signed_headers(method: str, path: str, body: bytes):
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


def _parse_sse(text: str) -> list:
    events = []
    for line in text.split("\n"):
        if line.startswith("data: "):
            payload = line[6:]
            if payload == "[DONE]":
                events.append("[DONE]")
            else:
                events.append(json.loads(payload))
    return events


def _mock_conn(processing_status="ready"):
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "id": 1,
        "processing_status": processing_status,
        "file_path": "/tmp/fake.pdf",
    }
    conn.execute.return_value = None
    return conn


def test_chat_sse_contract():
    """Full happy path: sources → tokens → [DONE]."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake_retrieval = RetrievalResult(
        supporting_chunks=[ChunkRow(1, "Some content", 3, 3, 0.85)],
        page_text=None, anchor_text=None,
        sources=[{"page": 3, "relevance": 0.85}],
    )

    async def fake_run_chat(**kwargs):
        yield ("token", "Hello ")
        yield ("token", "world")

    try:
        with (
            patch("routers.chat.retrieve", return_value=fake_retrieval),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
        ):
            body = json.dumps({"question": "What is this?"}).encode()
            r = client.post("/agents/chat", content=body,
                           headers=_signed_headers("POST", "/agents/chat", body))
            assert r.status_code == 200
            assert r.headers["content-type"] == "text/event-stream; charset=utf-8"

            events = _parse_sse(r.text)
            # First event: sources
            assert events[0]["type"] == "sources"
            assert events[0]["sources"] == [{"page": 3, "relevance": 0.85}]
            assert "conversationId" in events[0]
            # Token events
            tokens = [e for e in events if isinstance(e, dict) and e.get("type") == "token"]
            assert len(tokens) == 2
            assert tokens[0]["content"] == "Hello "
            assert tokens[1]["content"] == "world"
            # Last: [DONE]
            assert events[-1] == "[DONE]"
    finally:
        app.dependency_overrides.clear()


def test_chat_processing_status_guard():
    """Document not ready → status message SSE stream."""
    mock_conn = _mock_conn(processing_status="processing")
    mock_conn.fetchrow.return_value = {"id": 1, "processing_status": "processing"}

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"question": "What is this?"}).encode()
        r = client.post("/agents/chat", content=body,
                       headers=_signed_headers("POST", "/agents/chat", body))
        assert r.status_code == 200
        events = _parse_sse(r.text)
        assert events[0]["type"] == "sources"
        assert events[0]["sources"] == []
        token_events = [e for e in events if isinstance(e, dict) and e.get("type") == "token"]
        assert "still being processed" in token_events[0]["content"]
        assert events[-1] == "[DONE]"
    finally:
        app.dependency_overrides.clear()


def test_chat_empty_retrieval_guard():
    """No context found → empty-retrieval message."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    empty_retrieval = RetrievalResult(
        supporting_chunks=[], page_text=None, anchor_text=None, sources=[],
    )

    try:
        with patch("routers.chat.retrieve", return_value=empty_retrieval):
            body = json.dumps({"question": "What is this?"}).encode()
            r = client.post("/agents/chat", content=body,
                           headers=_signed_headers("POST", "/agents/chat", body))
            assert r.status_code == 200
            events = _parse_sse(r.text)
            assert events[0]["type"] == "sources"
            token_events = [e for e in events if isinstance(e, dict) and e.get("type") == "token"]
            assert "cannot find any content" in token_events[0]["content"]
            assert events[-1] == "[DONE]"
    finally:
        app.dependency_overrides.clear()


def test_chat_404_when_doc_not_found():
    mock_conn = AsyncMock()
    mock_conn.fetchrow.return_value = None

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"question": "Hello"}).encode()
        r = client.post("/agents/chat", content=body,
                       headers=_signed_headers("POST", "/agents/chat", body))
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_chat_unauthenticated():
    body = json.dumps({"question": "Hello"}).encode()
    r = client.post("/agents/chat", content=body)
    assert r.status_code == 401


def test_chat_no_tool_calls_does_not_create_highlight_run():
    """When the agent emits only tokens, no ai_highlight_runs row is inserted."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake_retrieval = RetrievalResult(
        supporting_chunks=[ChunkRow(1, "c", 3, 3, 0.85)],
        page_text=None, anchor_text=None,
        sources=[{"page": 3, "relevance": 0.85}],
    )

    async def fake_run_chat(**kwargs):
        yield ("token", "hi")

    try:
        with (
            patch("routers.chat.retrieve", return_value=fake_retrieval),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
        ):
            body = json.dumps({"question": "?"}).encode()
            r = client.post("/agents/chat", content=body,
                           headers=_signed_headers("POST", "/agents/chat", body))
            assert r.status_code == 200
            # Walk fetchrow calls and assert none inserted into ai_highlight_runs.
            for call in mock_conn.fetchrow.call_args_list:
                sql = call[0][0] if call[0] else ""
                assert "ai_highlight_runs" not in sql, f"unexpected run insert: {sql}"
    finally:
        app.dependency_overrides.clear()


def test_chat_create_highlights_tool_call_inserts_run_and_finalizes():
    """When agent calls create_highlights, a run row is inserted and finalized."""
    mock_conn = _mock_conn()

    # fetchrow is used for document lookup, conversation upsert, AND the run insert.
    # Sequence: doc fetch → upsert_conversation fetchrow → ai_highlight_runs insert.
    run_uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    fetchrow_calls = []

    async def fetchrow_side_effect(sql, *args):
        fetchrow_calls.append(sql)
        if "ai_highlight_runs" in sql:
            return {"id": run_uuid}
        if "agent_conversations" in sql:
            return {"id": 1}
        # documents lookup
        return {"id": 1, "processing_status": "ready", "file_path": "/tmp/fake.pdf"}

    mock_conn.fetchrow.side_effect = fetchrow_side_effect

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake_retrieval = RetrievalResult(
        supporting_chunks=[ChunkRow(1, "c", 3, 3, 0.85)],
        page_text=None, anchor_text=None, sources=[],
    )

    captured_ensure_run_id = {}

    def fake_build_tools(conn, user_id, document_id, get_run_id, api_key, pdf_path, conn_lock=None):
        captured_ensure_run_id["fn"] = get_run_id
        return []

    async def fake_run_chat(**kwargs):
        # Simulate the agent calling create_highlights: the real tool awaits
        # ensure_run_id internally, which inserts the run row.
        ensure = captured_ensure_run_id.get("fn")
        if ensure is not None:
            await ensure()
        yield ("token", "ok")
        yield ("tool_call", "create_highlights", {"matches": []})
        yield ("tool_result", "create_highlights", {"inserted": 3, "total_in_run": 3, "capped": False})
        yield ("tool_call", "finish", {"summary": "Highlighted X."})
        yield ("tool_result", "finish", {"summary": "Highlighted X.", "done": True})

    try:
        with (
            patch("routers.chat.retrieve", return_value=fake_retrieval),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
            patch("routers.chat.build_tools", side_effect=fake_build_tools),
        ):
            body = json.dumps({"question": "highlight losses"}).encode()
            r = client.post("/agents/chat", content=body,
                           headers=_signed_headers("POST", "/agents/chat", body))
            assert r.status_code == 200

            # A run row was inserted (by the tool, via ensure_run_id)
            assert any("INSERT INTO ai_highlight_runs" in s for s in fetchrow_calls)

            # The run was finalized (status='completed') via conn.execute
            update_calls = [c for c in mock_conn.execute.call_args_list
                            if c[0] and "ai_highlight_runs" in c[0][0]
                            and "status = 'completed'" in c[0][0]]
            assert len(update_calls) == 1
            # The summary captured from finish tool should be persisted
            args = update_calls[0][0]
            assert "Highlighted X." in args
    finally:
        app.dependency_overrides.clear()


def test_chat_emits_highlight_progress_and_done_events():
    """tool_call for create_highlights → highlight_progress event; run finalized → highlight_done."""
    mock_conn = _mock_conn()
    run_uuid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

    async def fetchrow_side_effect(sql, *args):
        if "ai_highlight_runs" in sql:
            return {"id": run_uuid}
        if "agent_conversations" in sql:
            return {"id": 1}
        return {"id": 1, "processing_status": "ready", "file_path": "/tmp/fake.pdf"}

    mock_conn.fetchrow.side_effect = fetchrow_side_effect

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake_retrieval = RetrievalResult(
        supporting_chunks=[ChunkRow(1, "c", 3, 3, 0.85)],
        page_text=None, anchor_text=None, sources=[],
    )

    captured = {}

    def fake_build_tools(conn, user_id, document_id, get_run_id, api_key, pdf_path, conn_lock=None):
        captured["fn"] = get_run_id
        return []

    async def fake_run_chat(**kwargs):
        ensure = captured.get("fn")
        if ensure is not None:
            await ensure()
        yield ("tool_call", "semantic_search", {"query": "x"})
        yield ("tool_result", "semantic_search", {"matches": []})
        yield ("tool_call", "create_highlights", {"matches": []})
        yield ("tool_result", "create_highlights", {"inserted": 3, "total_in_run": 3, "capped": False})

    try:
        with (
            patch("routers.chat.retrieve", return_value=fake_retrieval),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
            patch("routers.chat.build_tools", side_effect=fake_build_tools),
        ):
            body = json.dumps({"question": "highlight losses"}).encode()
            r = client.post("/agents/chat", content=body,
                           headers=_signed_headers("POST", "/agents/chat", body))
            assert r.status_code == 200

            events = _parse_sse(r.text)
            progress = [e for e in events if isinstance(e, dict) and e.get("type") == "highlight_progress"]
            steps = [e["step"] for e in progress]
            assert "semantic_search" in steps
            assert "create_highlights" in steps
            assert all(e.get("label") for e in progress)
            # detail is now included alongside label, computed from tool args
            assert all("detail" in e for e in progress)
            by_step = {e["step"]: e for e in progress}
            assert "searching" in by_step["semantic_search"]["detail"]
            assert "x" in by_step["semantic_search"]["detail"]
            assert "highlight" in by_step["create_highlights"]["detail"]

            done = [e for e in events if isinstance(e, dict) and e.get("type") == "highlight_done"]
            assert len(done) == 1
            assert done[0]["runId"] == run_uuid
            assert done[0]["count"] == 3
            assert events[-1] == "[DONE]"
    finally:
        app.dependency_overrides.clear()


def test_chat_no_highlight_events_when_no_tool_calls():
    """Only token events → no highlight_progress and no highlight_done."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake_retrieval = RetrievalResult(
        supporting_chunks=[ChunkRow(1, "c", 3, 3, 0.85)],
        page_text=None, anchor_text=None, sources=[],
    )

    async def fake_run_chat(**kwargs):
        yield ("token", "hi")

    try:
        with (
            patch("routers.chat.retrieve", return_value=fake_retrieval),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
        ):
            body = json.dumps({"question": "?"}).encode()
            r = client.post("/agents/chat", content=body,
                           headers=_signed_headers("POST", "/agents/chat", body))
            assert r.status_code == 200
            events = _parse_sse(r.text)
            assert not any(isinstance(e, dict) and e.get("type") == "highlight_progress" for e in events)
            assert not any(isinstance(e, dict) and e.get("type") == "highlight_done" for e in events)
    finally:
        app.dependency_overrides.clear()


def test_chat_ignores_non_highlight_tool_calls_for_progress():
    """tool_call for unrecognized tool name → no highlight_progress emitted."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake_retrieval = RetrievalResult(
        supporting_chunks=[ChunkRow(1, "c", 3, 3, 0.85)],
        page_text=None, anchor_text=None, sources=[],
    )

    async def fake_run_chat(**kwargs):
        yield ("tool_call", "unknown_tool", {})
        yield ("token", "ok")

    try:
        with (
            patch("routers.chat.retrieve", return_value=fake_retrieval),
            patch("routers.chat.run_chat", side_effect=fake_run_chat),
        ):
            body = json.dumps({"question": "?"}).encode()
            r = client.post("/agents/chat", content=body,
                           headers=_signed_headers("POST", "/agents/chat", body))
            assert r.status_code == 200
            events = _parse_sse(r.text)
            assert not any(isinstance(e, dict) and e.get("type") == "highlight_progress" for e in events)
            assert not any(isinstance(e, dict) and e.get("type") == "highlight_done" for e in events)
    finally:
        app.dependency_overrides.clear()
