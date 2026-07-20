import hashlib
import hmac
import json
import os
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)

PATH = "/agents/auto-highlight"
PAPER_ID = "00000000-0000-0000-0000-000000000001"


def _signed_headers(method: str, path: str, body: bytes, paper_id: str | None = PAPER_ID):
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
    if paper_id is not None:
        h["X-Inhale-Paper-Id"] = paper_id
    return h


@asynccontextmanager
async def _fake_download(key, suffix=".pdf"):
    """Stand-in for lib.storage.download_to_tempfile: yields a local path
    without hitting S3 (route now downloads source.pdf before reading)."""
    yield "/tmp/fake.pdf"


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


def _mock_conn(paper_exists=True):
    """Mock connection supporting the route's DB calls."""
    conn = AsyncMock()

    # SELECT papers -> paper row
    paper_row = {"id": PAPER_ID, "storage_url": "/tmp/fake.pdf"} if paper_exists else None
    # INSERT agent_conversations ... RETURNING id
    conv_row = {"id": 42}
    # INSERT ai_highlight_runs ... RETURNING id
    run_row = {"id": "11111111-1111-1111-1111-111111111111"}

    async def fetchrow(query, *args):
        q = query.strip().upper()
        if "FROM PAPERS" in q:
            return paper_row
        if "AGENT_CONVERSATIONS" in q and "INSERT" in q:
            return conv_row
        if "AI_HIGHLIGHT_RUNS" in q and "INSERT" in q:
            return run_row
        return None

    conn.fetchrow.side_effect = fetchrow
    conn.execute.return_value = None
    conn.fetchval.return_value = 0
    return conn


def test_auto_highlight_selects_storage_url_not_file_path():
    """Regression: papers table has `storage_url`, not `file_path`. Round F prod 500 fix.

    Asserts the auto_highlight handler's SQL queries the correct column and that
    the resulting dict key access matches. Mocks DB conn and captures the query.
    """
    captured_queries: list[str] = []
    conn = AsyncMock()

    async def fetchrow(query, *args):
        captured_queries.append(query)
        q = query.strip().upper()
        if "FROM PAPERS" in q:
            return {"id": PAPER_ID, "storage_url": "/tmp/fake.pdf"}
        if "AGENT_CONVERSATIONS" in q and "INSERT" in q:
            return {"id": 42}
        if "AI_HIGHLIGHT_RUNS" in q and "INSERT" in q:
            return {"id": "11111111-1111-1111-1111-111111111111"}
        return None

    conn.fetchrow.side_effect = fetchrow
    conn.execute.return_value = None
    conn.fetchval.return_value = 0

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake = MagicMock()

    async def astream(_input, _config=None, *, stream_mode=None, **kwargs):
        from langchain_core.messages import AIMessage

        yield {
            "model": {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "finish",
                                "args": {"summary": "done"},
                                "id": "c1",
                                "type": "tool_call",
                            }
                        ],
                    )
                ]
            }
        }

    fake.astream = astream

    try:
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            body = json.dumps({"instruction": "x"}).encode()
            r = client.post(PATH, content=body, headers=_signed_headers("POST", PATH, body))
            assert r.status_code == 200
            # consume stream
            _ = r.text

        papers_queries = [q for q in captured_queries if "FROM papers" in q]
        assert papers_queries, "expected at least one SELECT ... FROM papers"
        for q in papers_queries:
            assert "storage_url" in q, f"query must select storage_url, got: {q}"
            assert "file_path" not in q, f"query must NOT reference file_path, got: {q}"
    finally:
        app.dependency_overrides.clear()


def test_unauthenticated():
    body = json.dumps({"instruction": "highlight losses"}).encode()
    r = client.post(PATH, content=body)
    assert r.status_code == 401


def test_missing_paper_id():
    body = json.dumps({"instruction": "highlight losses"}).encode()
    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        r = client.post(
            PATH,
            content=body,
            headers=_signed_headers("POST", PATH, body, paper_id=None),
        )
        assert r.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_paper_not_found():
    mock_conn = _mock_conn(paper_exists=False)

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        body = json.dumps({"instruction": "highlight losses"}).encode()
        r = client.post(PATH, content=body, headers=_signed_headers("POST", PATH, body))
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_source_pdf_missing_returns_404():
    """GSD-135: DB row exists, but S3 source.pdf object is gone.

    Auto-highlight must short-circuit with 404 detail=source_pdf_missing
    BEFORE opening the SSE stream / langchain agent (which would crash
    inside pypdf with `[Errno 2] No such file or directory`).
    """
    mock_conn = _mock_conn(paper_exists=True)

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override
    try:
        with patch(
            "routers.auto_highlight.object_exists", AsyncMock(return_value=False)
        ):
            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(PATH, content=body, headers=_signed_headers("POST", PATH, body))
            assert r.status_code == 404, r.text
            assert r.json() == {"detail": "source_pdf_missing"}
    finally:
        app.dependency_overrides.clear()


def test_auto_highlight_downloads_to_tempfile_for_tools():
    """GSD-135 deeper fix: auto-highlight must DOWNLOAD source.pdf to a local
    tempfile and pass that LOCAL path into build_tools (the tools open it with
    pypdf/pdfplumber). It must NOT hand the raw R2 key to the tools.
    """
    storage_key = f"{PAPER_ID}/source.pdf"
    conn = AsyncMock()

    async def fetchrow(query, *args):
        q = query.strip().upper()
        if "FROM PAPERS" in q:
            return {"id": PAPER_ID, "storage_url": storage_key}
        if "AGENT_CONVERSATIONS" in q and "INSERT" in q:
            return {"id": 42}
        if "AI_HIGHLIGHT_RUNS" in q and "INSERT" in q:
            return {"id": "11111111-1111-1111-1111-111111111111"}
        return None

    conn.fetchrow.side_effect = fetchrow
    conn.execute.return_value = None
    conn.fetchval.return_value = 0

    async def override():
        yield conn

    app.dependency_overrides[deps.db.get_conn] = override

    local_tmp = "/tmp/downloaded-autohl.pdf"
    captured: dict = {}

    @asynccontextmanager
    async def fake_download(key, suffix=".pdf"):
        assert key == storage_key
        yield local_tmp

    def fake_build_tools(conn_, user_id, paper_id, get_run_id, api_key, pdf_path, **kw):
        captured["pdf_path"] = pdf_path
        return []

    fake = MagicMock()

    async def astream(_input, _config=None, *, stream_mode=None, **kwargs):
        from langchain_core.messages import AIMessage

        yield {
            "model": {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {"name": "finish", "args": {"summary": "done"},
                             "id": "c1", "type": "tool_call"}
                        ],
                    )
                ]
            }
        }

    fake.astream = astream

    try:
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", fake_download),
            patch("routers.auto_highlight.build_tools", fake_build_tools),
        ):
            body = json.dumps({"instruction": "x"}).encode()
            r = client.post(PATH, content=body, headers=_signed_headers("POST", PATH, body))
            assert r.status_code == 200
            _ = r.text  # drain stream so the download CM stays open through it
        assert captured["pdf_path"] == local_tmp, (
            f"build_tools must get the local tempfile, got {captured.get('pdf_path')!r}"
        )
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
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake_agent),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            mock_conn.fetchval.return_value = 2

            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200
            assert r.headers["content-type"] == "text/event-stream; charset=utf-8"

            events = _parse_sse(r.text)
            assert events[0]["type"] == "run"
            assert "runId" in events[0]
            assert events[0]["conversationId"] == 42

            progress = [
                e for e in events if isinstance(e, dict) and e.get("type") == "progress"
            ]
            assert len(progress) >= 1
            steps = [e["step"] for e in progress]
            assert "semantic_search" in steps
            assert progress[0]["detail"].startswith("searching:")

            done = [
                e for e in events if isinstance(e, dict) and e.get("type") == "done"
            ]
            assert len(done) == 1
            assert done[0]["summary"] == "Highlighted 2 passages."
            assert done[0]["highlightsCount"] == 2

            assert events[-1] == "[DONE]"

        executes = [c.args for c in mock_conn.execute.call_args_list]
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
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200

            events = _parse_sse(r.text)
            assert events[0]["type"] == "run"
            errs = [
                e for e in events if isinstance(e, dict) and e.get("type") == "error"
            ]
            assert len(errs) == 1
            assert "llm exploded" in errs[0]["message"]
            assert events[-1] == "[DONE]"

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


def test_recursion_limit_emits_graceful_terminal_state():
    """GSD-138: when the langgraph agent loop hits GRAPH_RECURSION_LIMIT
    without converging, the stream must emit a structured, user-friendly
    terminal `error` event (code + readable message) instead of leaking the
    raw "Recursion limit of N reached..." string as a generic toast. The run
    row is still marked failed and the stream closes cleanly with [DONE].
    """
    from langgraph.errors import GraphRecursionError

    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    fake = MagicMock()

    async def astream(_input, _config=None, *, stream_mode=None, **kwargs):
        yield {"model": {"messages": []}}
        raise GraphRecursionError(
            "Recursion limit of 25 reached without hitting a stop condition."
        )

    fake.astream = astream

    try:
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200

            events = _parse_sse(r.text)
            errs = [
                e for e in events if isinstance(e, dict) and e.get("type") == "error"
            ]
            assert len(errs) == 1, events
            err = errs[0]
            # Stable machine code for the UI to branch on.
            assert err.get("code") == "recursion_limit"
            # Human message must NOT be the raw langgraph string.
            assert "Recursion limit of" not in err["message"]
            assert "couldn't finish" in err["message"].lower() or (
                "too many" in err["message"].lower()
            )
            assert events[-1] == "[DONE]"

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
        auth = {"user_id": "user_1", "paper_id": PAPER_ID, "llm_key": "sk-test"}
        body = type(
            "B", (), {"instruction": "highlight losses", "conversationId": None}
        )()
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            resp = await auto_highlight(body, auth, mock_conn)
            cancelled = False
            try:
                async for _chunk in resp.body_iterator:
                    pass
            except asyncio.CancelledError:
                cancelled = True
            assert cancelled, "CancelledError should be re-raised to the caller"

    asyncio.run(run())

    executes = [c.args for c in mock_conn.execute.call_args_list]
    failed_updates = [
        args
        for args in executes
        if "UPDATE" in args[0].upper()
        and "AI_HIGHLIGHT_RUNS" in args[0].upper()
        and "failed" in " ".join(str(a) for a in args)
    ]
    assert len(failed_updates) >= 1


def test_auto_highlight_agent_wires_no_parallel_middleware():
    """GSD-138: the auto-highlight agent must be built WITH the
    `no_parallel_tool_calls` middleware (wiring guard).

    This asserts wiring only; the async-path behavior (that the flag actually
    reaches bind_tools under .astream()) is proved by
    `test_no_parallel_flag_reaches_bind_tools_on_async_path` below.
    """
    from lib.no_parallel_tools import no_parallel_tool_calls

    mock_conn = _mock_conn()

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    captured: dict = {}

    def fake_create_agent(*args, **kwargs):
        captured["middleware"] = kwargs.get("middleware")
        return _make_fake_agent([{"model": {"messages": []}}])

    try:
        with (
            patch("routers.auto_highlight.create_agent", fake_create_agent),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200
            _ = r.text  # drain stream

        middleware = captured.get("middleware") or []
        assert no_parallel_tool_calls in middleware, (
            "auto-highlight create_agent must include the no_parallel_tool_calls "
            f"middleware; got {middleware!r}"
        )
    finally:
        app.dependency_overrides.clear()


def test_no_parallel_flag_reaches_bind_tools_on_async_path():
    """GSD-138 async-path regression (the bug a `.invoke()`-only test hid).

    Both real call sites drive the agent with `.astream()` (async), which routes
    through `awrap_model_call`, NOT `wrap_model_call`. A sync-only
    `@wrap_model_call` middleware raises NotImplementedError on the async path,
    so `parallel_tool_calls=False` NEVER reaches `model.bind_tools(...)` and the
    parallel-tool-call cancellation keeps corrupting highlight runs.

    Build a REAL `create_agent` agent with the real `no_parallel_tool_calls`
    middleware and a real `ChatOpenAI`, spy on `ChatOpenAI.bind_tools`, and drive
    a real `.astream(...)`. The network call is expected to fail (no server), but
    only AFTER bind_tools runs — proving the flag was threaded through the async
    middleware chain into the provider binding.
    """
    import asyncio

    from langchain.agents import create_agent
    from langchain_core.tools import tool
    from langchain_openai import ChatOpenAI

    from lib.no_parallel_tools import no_parallel_tool_calls

    @tool
    def sample_tool(x: str) -> str:
        """A sample tool."""
        return x

    calls: list[dict] = []
    orig_bind_tools = ChatOpenAI.bind_tools

    def spy_bind_tools(self, tools, **kwargs):
        calls.append(kwargs)
        return orig_bind_tools(self, tools, **kwargs)

    model = ChatOpenAI(
        model="gpt-4o-mini",
        api_key="sk-test",
        base_url="http://127.0.0.1:1",  # unroutable: forces a fast connection error
    )
    agent = create_agent(
        model=model,
        tools=[sample_tool],
        system_prompt="hi",
        middleware=[no_parallel_tool_calls],
    )

    async def drive():
        with patch.object(ChatOpenAI, "bind_tools", spy_bind_tools):
            try:
                async for _ in agent.astream(
                    {"messages": [{"role": "user", "content": "hi"}]}
                ):
                    pass
            except Exception:
                # Network failure AFTER bind_tools is the expected/normal outcome.
                pass

    asyncio.run(drive())

    assert calls, (
        "bind_tools was never called on the async path — the sync-only "
        "middleware raised NotImplementedError under .astream() before the model "
        "was ever bound (this is the GSD-138 bug)."
    )
    assert any(c.get("parallel_tool_calls") is False for c in calls), (
        "parallel_tool_calls=False must reach model.bind_tools() on the async "
        f"(.astream) path; bind_tools kwargs seen: {calls!r}"
    )


def test_create_highlights_attempted_but_none_persisted_emits_terminal_error():
    """GSD-138 no-silent-death: the model ATTEMPTED create_highlights (so it
    intended to persist) but the run ended with 0 rows persisted and no `finish`
    — the superseded-tool-call outcome ("another message came in before it could
    be completed"). Must emit a terminal `error` (code='no_highlights') and mark
    the run failed, NOT a hollow `done`.
    """
    from langchain_core.messages import AIMessage

    mock_conn = _mock_conn()
    mock_conn.fetchval.return_value = 0  # zero highlights persisted

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    # Model attempts create_highlights, then the stream ends — the tool call was
    # superseded/cancelled, so no rows landed and finish was never reached.
    updates = [
        {
            "model": {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "create_highlights",
                                "args": {"matches": [{"page_number": 1}]},
                                "id": "call_1",
                                "type": "tool_call",
                            }
                        ],
                    )
                ]
            }
        },
    ]
    fake_agent = _make_fake_agent(updates)

    try:
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake_agent),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            body = json.dumps({"instruction": "highlight losses"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200

            events = _parse_sse(r.text)
            errs = [
                e for e in events if isinstance(e, dict) and e.get("type") == "error"
            ]
            assert len(errs) == 1, events
            assert errs[0].get("code") == "no_highlights", errs[0]
            dones = [
                e for e in events if isinstance(e, dict) and e.get("type") == "done"
            ]
            assert not dones, "must not emit a hollow done event"
            assert events[-1] == "[DONE]"

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


def test_clean_no_match_prose_exit_is_not_an_error():
    """GSD-138 false-positive guard: when NO passages match, the tool spec tells
    the model to respond in prose WITHOUT calling create_highlights or finish
    (auto_highlight_tools.py). That legitimate zero-result run must NOT be
    reported as a `no_highlights` error — it completes as `done`.
    """
    from langchain_core.messages import AIMessage

    mock_conn = _mock_conn()
    mock_conn.fetchval.return_value = 0  # zero highlights, but that's fine here

    async def override():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override

    # Model does a semantic_search, finds nothing relevant, and answers in prose
    # — it never attempts create_highlights and never calls finish.
    updates = [
        {
            "model": {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "semantic_search",
                                "args": {"query": "unicorns"},
                                "id": "call_1",
                                "type": "tool_call",
                            }
                        ],
                    )
                ]
            }
        },
        {
            "model": {
                "messages": [
                    AIMessage(content="I found no passages matching that.")
                ]
            }
        },
    ]
    fake_agent = _make_fake_agent(updates)

    try:
        with (
            patch("routers.auto_highlight.create_agent", return_value=fake_agent),
            patch("routers.auto_highlight.object_exists", AsyncMock(return_value=True)),
            patch("routers.auto_highlight.download_to_tempfile", _fake_download),
        ):
            body = json.dumps({"instruction": "highlight unicorns"}).encode()
            r = client.post(
                PATH, content=body, headers=_signed_headers("POST", PATH, body)
            )
            assert r.status_code == 200

            events = _parse_sse(r.text)
            errs = [
                e for e in events if isinstance(e, dict) and e.get("type") == "error"
            ]
            assert not errs, f"clean no-match prose exit must not error: {events}"
            dones = [
                e for e in events if isinstance(e, dict) and e.get("type") == "done"
            ]
            assert len(dones) == 1
            assert dones[0]["highlightsCount"] == 0
            assert events[-1] == "[DONE]"

        executes = [c.args for c in mock_conn.execute.call_args_list]
        completed_updates = [
            args
            for args in executes
            if "UPDATE" in args[0].upper()
            and "AI_HIGHLIGHT_RUNS" in args[0].upper()
            and "completed" in " ".join(str(a) for a in args)
        ]
        assert len(completed_updates) >= 1, "clean no-match run must be completed"
    finally:
        app.dependency_overrides.clear()


def test_sequential_multi_candidate_run_fits_recursion_limit():
    """GSD-138 codex RISK: forcing `parallel_tool_calls=False` serializes tool
    calls, so each highlight candidate costs its own model↔tool round instead of
    sharing a parallel turn. That consumes more langgraph super-steps against
    AGENT_RECURSION_LIMIT=40 (routers/auto_highlight.py).

    Drive the REAL `create_agent` graph (real langgraph super-step accounting)
    with a scripted model that mimics the worst realistic sequential shape —
    semantic_search, then page_text + locate_phrase one-tool-per-turn for 8
    candidates, then create_highlights, then finish — and assert it reaches
    `finish` WITHOUT GraphRecursionError at the production limit of 40.

    Measured headroom (this harness, limit=40): 8 candidates one-tool-per-turn
    fit (19 model turns ≈ 38 super-steps); 9 candidates trip the limit. 8
    passages is ample for a realistic multi-passage instruction, so 40 has
    enough headroom for the forced-sequential regime. If the toolbelt ever grows
    tool rounds per candidate, bump AGENT_RECURSION_LIMIT and this fixture.
    """
    import asyncio
    from typing import Any

    from langchain.agents import create_agent
    from langchain_core.callbacks import CallbackManagerForLLMRun
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, BaseMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool
    from langgraph.errors import GraphRecursionError

    from lib.no_parallel_tools import no_parallel_tool_calls
    from routers.auto_highlight import AGENT_RECURSION_LIMIT

    # Stub tools mirroring the real toolbelt names so the graph's ToolNode runs
    # trivially (no PDF/DB) while the model drives a realistic call sequence.
    @tool
    def semantic_search(query: str) -> str:
        """Find candidate passages."""
        return "candidates found"

    @tool
    def page_text(page_number: int) -> str:
        """Read a page's text."""
        return "page text"

    @tool
    def locate_phrase(page_number: int, phrase: str) -> str:
        """Locate a phrase's offsets/rects."""
        return "located"

    @tool
    def create_highlights(matches: list) -> str:
        """Persist the highlight batch."""
        return "created"

    @tool
    def finish(summary: str) -> str:
        """Finish the run."""
        return "done"

    N_CANDIDATES = 8

    def _tc(name: str, args: dict, i: int) -> dict:
        return {"name": name, "args": args, "id": f"call_{i}", "type": "tool_call"}

    # One tool call PER model turn (the forced-sequential worst case).
    script: list[dict] = [_tc("semantic_search", {"query": "q"}, 0)]
    idx = 1
    for c in range(N_CANDIDATES):
        script.append(_tc("page_text", {"page_number": c + 1}, idx))
        idx += 1
        script.append(_tc("locate_phrase", {"page_number": c + 1, "phrase": "p"}, idx))
        idx += 1
    script.append(_tc("create_highlights", {"matches": [{"page_number": 1}]}, idx))
    idx += 1
    script.append(_tc("finish", {"summary": "done"}, idx))

    class ScriptedModel(BaseChatModel):
        """Emits one scripted tool call per turn, then a plain terminal message.

        The agent loop stops when the model returns a message with NO tool calls,
        so the post-script turn must be plain content (mirroring the model's
        final assistant reply after `finish`).
        """

        step: int = 0

        @property
        def _llm_type(self) -> str:
            return "scripted"

        def bind_tools(self, tools, **kwargs):
            # Tool schemas don't affect the scripted output; ignore them (and the
            # parallel_tool_calls kwarg the middleware injects) and just bind.
            return self.bind(**kwargs)

        def _generate(
            self,
            messages: list[BaseMessage],
            stop: list[str] | None = None,
            run_manager: CallbackManagerForLLMRun | None = None,
            **kwargs: Any,
        ) -> ChatResult:
            i = self.step
            self.step += 1
            if i < len(script):
                msg = AIMessage(content="", tool_calls=[script[i]])
            else:
                msg = AIMessage(content="Highlighting complete.")
            return ChatResult(generations=[ChatGeneration(message=msg)])

    agent = create_agent(
        model=ScriptedModel(),
        tools=[semantic_search, page_text, locate_phrase, create_highlights, finish],
        system_prompt="hi",
        middleware=[no_parallel_tool_calls],
    )

    saw_finish = {"v": False}

    async def drive():
        async for update in agent.astream(
            {"messages": [{"role": "user", "content": "highlight everything"}]},
            config={"recursion_limit": AGENT_RECURSION_LIMIT},
            stream_mode="updates",
        ):
            for _node, state in (update or {}).items():
                for m in (state or {}).get("messages", []) or []:
                    for tc in getattr(m, "tool_calls", None) or []:
                        if tc.get("name") == "finish":
                            saw_finish["v"] = True

    try:
        asyncio.run(drive())
    except GraphRecursionError as e:  # pragma: no cover - the failure we guard
        raise AssertionError(
            f"{N_CANDIDATES}-candidate sequential highlight run exceeded "
            f"AGENT_RECURSION_LIMIT={AGENT_RECURSION_LIMIT}: {e}"
        ) from e

    assert saw_finish["v"], (
        "sequential multi-candidate run must reach `finish` within "
        f"AGENT_RECURSION_LIMIT={AGENT_RECURSION_LIMIT}"
    )
