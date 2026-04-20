import hashlib
import hmac
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from main import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)

PATH = "/agents/auto-highlight"


def _signed_headers(method: str, path: str, body: bytes, document_id: str | None = "1"):
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    h = {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }
    if document_id is not None:
        h["X-Inhale-Document-Id"] = document_id
    return h


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


def _mock_conn(doc_exists=True):
    """Mock connection supporting the route's DB calls."""
    conn = AsyncMock()

    # SELECT documents -> doc row
    doc_row = {"id": 1, "file_path": "/tmp/fake.pdf"} if doc_exists else None
    # INSERT agent_conversations ... RETURNING id
    conv_row = {"id": 42}
    # INSERT ai_highlight_runs ... RETURNING id
    run_row = {"id": "11111111-1111-1111-1111-111111111111"}

    async def fetchrow(query, *args):
        q = query.strip().upper()
        if "FROM DOCUMENTS" in q:
            return doc_row
        if "AGENT_CONVERSATIONS" in q and "INSERT" in q:
            return conv_row
        if "AI_HIGHLIGHT_RUNS" in q and "INSERT" in q:
            return run_row
        return None

    conn.fetchrow.side_effect = fetchrow
    conn.execute.return_value = None
    conn.fetchval.return_value = 0
    return conn


def test_unauthenticated():
    body = json.dumps({"instruction": "highlight losses"}).encode()
    r = client.post(PATH, content=body)
    assert r.status_code == 401


def test_missing_document_id():
    body = json.dumps({"instruction": "highlight losses"}).encode()
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        r = client.post(
            PATH,
            content=body,
            headers=_signed_headers("POST", PATH, body, document_id=None),
        )
        assert r.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_document_not_found():
    mock_conn = _mock_conn(doc_exists=False)

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"instruction": "highlight losses"}).encode()
        r = client.post(PATH, content=body, headers=_signed_headers("POST", PATH, body))
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def _make_fake_agent(updates):
    """Build a fake agent whose astream yields a scripted list of update dicts."""
    fake = MagicMock()

    async def astream(_input, _config=None, *, stream_mode=None, **kwargs):
        for u in updates:
            yield u

    fake.astream = astream
    return fake


def test_happy_path_streams_run_progress_done():
    """Mock agent yields a tool-call update, then finish. Assert SSE shape."""
    from langchain_core.messages import AIMessage, ToolMessage

    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    # Scripted updates: model calls semantic_search, tools node runs it,
    # model calls finish, tools node runs it (returns summary).
    updates = [
        {
            "model": {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "semantic_search",
                                "args": {"query": "loss"},
                                "id": "call_1",
                                "type": "tool_call",
                            }
                        ],
                    )
                ]
            }
        },
        {
            "tools": {
                "messages": [
                    ToolMessage(
                        content="[]", tool_call_id="call_1", name="semantic_search"
                    )
                ]
            }
        },
        {
            "model": {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "finish",
                                "args": {"summary": "Highlighted 2 passages."},
                                "id": "call_2",
                                "type": "tool_call",
                            }
                        ],
                    )
                ]
            }
        },
        {
            "tools": {
                "messages": [
                    ToolMessage(
                        content=json.dumps(
                            {"summary": "Highlighted 2 passages.", "done": True}
                        ),
                        tool_call_id="call_2",
                        name="finish",
                    )
                ]
            }
        },
    ]

    fake_agent = _make_fake_agent(updates)

    try:
        with patch("routers.auto_highlight.create_agent", return_value=fake_agent):
            # Simulate 2 highlights inserted by create_highlights during the run
            mock_conn.fetchval.return_value = 2

            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200
            assert r.headers["content-type"] == "text/event-stream; charset=utf-8"

            events = _parse_sse(r.text)
            # First: run
            assert events[0]["type"] == "run"
            assert "runId" in events[0]
            assert events[0]["conversationId"] == 42

            # Progress events for tool calls
            progress = [
                e for e in events if isinstance(e, dict) and e.get("type") == "progress"
            ]
            assert len(progress) >= 1
            steps = [e["step"] for e in progress]
            assert "semantic_search" in steps
            # _progress_detail branching: semantic_search produces "searching: ..."
            assert progress[0]["detail"].startswith("searching:")

            # done
            done = [
                e for e in events if isinstance(e, dict) and e.get("type") == "done"
            ]
            assert len(done) == 1
            assert done[0]["summary"] == "Highlighted 2 passages."
            assert done[0]["highlightsCount"] == 2

            # terminator
            assert events[-1] == "[DONE]"

        # Verify ai_highlight_runs row was inserted as running, then updated completed
        executes = [c.args for c in mock_conn.execute.call_args_list]
        # look for UPDATE to 'completed'
        update_queries = [
            args[0]
            for args in executes
            if "UPDATE" in args[0].upper() and "AI_HIGHLIGHT_RUNS" in args[0].upper()
        ]
        assert any("completed" in q or "status" in q.lower() for q in update_queries)
    finally:
        app.dependency_overrides.clear()


def test_failure_path_marks_run_failed():
    """Agent raises → status='failed', error event, DONE terminator."""
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake = MagicMock()

    async def astream(_input, _config=None, *, stream_mode=None, **kwargs):
        yield {"model": {"messages": []}}
        raise RuntimeError("llm exploded")

    fake.astream = astream

    try:
        with patch("routers.auto_highlight.create_agent", return_value=fake):
            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200

            events = _parse_sse(r.text)
            # run event first
            assert events[0]["type"] == "run"
            # error event somewhere
            errs = [
                e for e in events if isinstance(e, dict) and e.get("type") == "error"
            ]
            assert len(errs) == 1
            assert "llm exploded" in errs[0]["message"]
            # [DONE] still terminates
            assert events[-1] == "[DONE]"

        # Verify UPDATE to 'failed' happened
        executes = [c.args for c in mock_conn.execute.call_args_list]
        failed_updates = [
            args
            for args in executes
            if "UPDATE" in args[0].upper()
            and "AI_HIGHLIGHT_RUNS" in args[0].upper()
            and "failed" in " ".join(str(a) for a in args)
        ]
        assert len(failed_updates) >= 1
    finally:
        app.dependency_overrides.clear()


def test_cancelled_run_marks_failed():
    """Browser disconnect (CancelledError) -> row marked 'failed' before re-raising."""
    import asyncio

    from routers.auto_highlight import auto_highlight

    mock_conn = _mock_conn()

    fake = MagicMock()

    async def astream(_input, _config=None, *, stream_mode=None, **kwargs):
        raise asyncio.CancelledError()
        yield  # pragma: no cover - makes this a generator

    fake.astream = astream

    async def run():
        auth = {"user_id": "user_1", "document_id": "1", "llm_key": "sk-test"}
        body = type(
            "B", (), {"instruction": "highlight losses", "conversationId": None}
        )()
        with patch("routers.auto_highlight.create_agent", return_value=fake):
            resp = await auto_highlight(body, auth, mock_conn)
            # Drain the streaming body; CancelledError should propagate.
            cancelled = False
            try:
                async for _chunk in resp.body_iterator:
                    pass
            except asyncio.CancelledError:
                cancelled = True
            assert cancelled, "CancelledError should be re-raised to the caller"

    asyncio.run(run())

    # Verify UPDATE to 'failed' happened from the CancelledError handler.
    executes = [c.args for c in mock_conn.execute.call_args_list]
    failed_updates = [
        args
        for args in executes
        if "UPDATE" in args[0].upper()
        and "AI_HIGHLIGHT_RUNS" in args[0].upper()
        and "failed" in " ".join(str(a) for a in args)
    ]
    assert len(failed_updates) >= 1
