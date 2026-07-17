import hmac
import hashlib
import json
import os
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import deps.db  # noqa: E402
from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# -----------------------------------------------------------------------------
# Edge-case enumeration (per plan §12) for /agents/embed-chunks
# -----------------------------------------------------------------------------
# applicable + tested:
#   - empty:          test_embed_chunks_rejects_empty_chunks (422 on chunks=[])
#   - auth-fail:      test_embed_chunks_unauthenticated (401 missing HMAC sig)
#   - idempotency:    test_embed_chunks_is_idempotent_on_retry (duplicate
#                     paper_id+chunk_index → ON CONFLICT DO NOTHING → 1 row)
#   - retry:          covered by idempotency case (second POST is the retry)
#   - partial-failure: covered by transaction-wrap assertion in
#                     test_embed_chunks_writes_inside_transaction (INSERT +
#                     UPDATE atomic — crash between leaves both unset)
#   - concurrent:     idempotency case proves duplicate writes collapse; full
#                     racing concurrency requires a real DB session — see
#                     "omitted, why" below.
# applicable but omitted (justified):
#   - null:           pydantic min_length=1 already rejects null/empty list;
#                     redundant with empty case.
#   - max-size:       pydantic max_length=512 enforced at boundary; not
#                     re-tested here (would test pydantic, not our code).
#   - unicode/emoji:  asyncpg passes content as bytea-text transparently;
#                     no per-byte logic in our path.
#   - real-DB race:   no asyncpg test fixture exists in services/agents
#                     (conftest.py is sys.path-only). True N-way concurrent
#                     UPSERT test would need an ephemeral Neon branch.
#                     Open question for orchestrator. UNIQUE constraint at
#                     SQL layer + ON CONFLICT clause is the canonical guard;
#                     RED-then-green on the mock proves the contract.
# -----------------------------------------------------------------------------


@asynccontextmanager
async def _noop_tx():
    yield


class _FakeConn:
    """Minimal asyncpg-conn double that emulates UNIQUE(paper_id, chunk_index)
    + ON CONFLICT DO NOTHING semantics. Tracks inserted (paper_id, chunk_index)
    pairs; second insert of the same pair is a no-op iff SQL contains
    ON CONFLICT. Verifies the writes happen inside `conn.transaction()`.
    """

    def __init__(self) -> None:
        self.inserted_keys: set[tuple[str, int]] = set()
        self.update_calls: list[tuple] = []
        self.in_transaction = False
        self.last_insert_sql: str | None = None
        self.last_update_sql: str | None = None

    def transaction(self):
        outer = self

        @asynccontextmanager
        async def _tx():
            outer.in_transaction = True
            try:
                yield
            finally:
                outer.in_transaction = False

        return _tx()

    async def fetchval(self, sql: str, *args):
        return 1

    async def executemany(self, sql: str, rows):
        self.last_insert_sql = sql
        on_conflict = "on conflict" in sql.lower()
        for row in rows:
            key = (row[0], row[1])
            if key in self.inserted_keys:
                if not on_conflict:
                    raise Exception(
                        "duplicate key value violates unique constraint "
                        '"document_chunks_paper_chunk_idx_unique"'
                    )
                continue
            self.inserted_keys.add(key)

    async def execute(self, sql: str, *args):
        self.last_update_sql = sql
        self.update_calls.append((sql, args))

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
        "X-Inhale-Paper-Id": "00000000-0000-0000-0000-000000000001",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def test_embed_chunks_stub_mode():
    """With INHALE_STUB_EMBEDDINGS=1, embeds are stubs. Mock DB to verify INSERT called."""
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=_noop_tx())

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({
            "paperId": "00000000-0000-0000-0000-000000000001",
            "chunks": [
                {"chunkIndex": 0, "content": "hello", "pageStart": 1, "pageEnd": 1, "tokenCount": 1},
                {"chunkIndex": 1, "content": "world", "pageStart": 1, "pageEnd": 2, "tokenCount": 1},
            ],
        }).encode()
        r = client.post(
            "/agents/embed-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/embed-chunks", body),
        )
        assert r.status_code == 200
        data = r.json()
        assert data == {"inserted": 2}
        mock_conn.executemany.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_embed_chunks_stamps_chunks_ready_at():
    """GSD-96 R1: after chunks + embeddings persist, papers.chunks_ready_at = now()."""
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=_noop_tx())

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({
            "paperId": "00000000-0000-0000-0000-000000000001",
            "chunks": [
                {"chunkIndex": 0, "content": "hello", "pageStart": 1, "pageEnd": 1, "tokenCount": 1},
            ],
        }).encode()
        r = client.post(
            "/agents/embed-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/embed-chunks", body),
        )
        assert r.status_code == 200
        # executemany for chunks insert + execute for chunks_ready_at update
        mock_conn.executemany.assert_called_once()
        mock_conn.execute.assert_called_once()
        update_args = mock_conn.execute.call_args
        sql = update_args[0][0]
        assert "UPDATE papers" in sql
        assert "chunks_ready_at" in sql
        assert update_args[0][1] == "00000000-0000-0000-0000-000000000001"
    finally:
        app.dependency_overrides.clear()


def test_embed_chunks_rejects_empty_chunks():
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=_noop_tx())

    async def override_get_conn():
        yield mock_conn

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({"paperId": "00000000-0000-0000-0000-000000000001", "chunks": []}).encode()
        r = client.post(
            "/agents/embed-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/embed-chunks", body),
        )
        assert r.status_code == 422  # validation error: min_length=1
    finally:
        app.dependency_overrides.clear()


def test_embed_chunks_unauthenticated():
    body = json.dumps({
        "paperId": "00000000-0000-0000-0000-000000000001",
        "chunks": [{"chunkIndex": 0, "content": "x", "pageStart": 1, "pageEnd": 1, "tokenCount": 1}],
    }).encode()
    r = client.post("/agents/embed-chunks", content=body)
    assert r.status_code == 401


def test_embed_chunks_is_idempotent_on_retry():
    """GSD-96 R1 fix: retry of embed-chunks with same paper_id + chunk_index
    must NOT duplicate rows. Requires UNIQUE(paper_id, chunk_index) +
    ON CONFLICT DO NOTHING in INSERT. Second call still stamps
    chunks_ready_at (idempotent UPDATE).
    """
    fake = _FakeConn()

    async def override_get_conn():
        yield fake

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({
            "paperId": "00000000-0000-0000-0000-000000000001",
            "chunks": [
                {"chunkIndex": 0, "content": "hello", "pageStart": 1, "pageEnd": 1, "tokenCount": 1},
                {"chunkIndex": 1, "content": "world", "pageStart": 1, "pageEnd": 2, "tokenCount": 1},
            ],
        }).encode()
        headers = _signed_headers("POST", "/agents/embed-chunks", body)

        r1 = client.post("/agents/embed-chunks", content=body, headers=headers)
        assert r1.status_code == 200

        # retry with same paper + chunk indices
        headers2 = _signed_headers("POST", "/agents/embed-chunks", body)
        r2 = client.post("/agents/embed-chunks", content=body, headers=headers2)
        assert r2.status_code == 200

        # exactly 2 rows total (not 4) — second call collapsed via ON CONFLICT
        assert fake.inserted_keys == {
            ("00000000-0000-0000-0000-000000000001", 0),
            ("00000000-0000-0000-0000-000000000001", 1),
        }, f"expected 2 unique rows, got {fake.inserted_keys}"

        # chunks_ready_at stamped both times (idempotent)
        assert len(fake.update_calls) == 2
        assert "chunks_ready_at" in fake.last_update_sql

        # SQL must declare ON CONFLICT — proves UNIQUE constraint guard
        assert "ON CONFLICT" in fake.last_insert_sql.upper()
        assert "DO NOTHING" in fake.last_insert_sql.upper()
    finally:
        app.dependency_overrides.clear()


def test_embed_chunks_writes_inside_transaction():
    """INSERT + UPDATE must be atomic. Asserts the handler opens a
    `conn.transaction()` ctx before writing — closes the orphan-signal window
    where chunks persisted but chunks_ready_at didn't (or vice-versa).
    """
    fake = _FakeConn()
    saw_tx = {"value": False}

    @asynccontextmanager
    async def _tx_observer():
        saw_tx["value"] = True
        # set flag during the write window — assertion in executemany
        fake.in_transaction = True
        try:
            yield
        finally:
            fake.in_transaction = False

    orig_executemany = fake.executemany
    orig_execute = fake.execute

    async def _exec_many(sql, rows):
        assert fake.in_transaction, "INSERT must run inside conn.transaction()"
        await orig_executemany(sql, rows)

    async def _exec(sql, *args):
        assert fake.in_transaction, "UPDATE must run inside conn.transaction()"
        await orig_execute(sql, *args)

    fake.transaction = _tx_observer  # type: ignore[method-assign]
    fake.executemany = _exec_many  # type: ignore[method-assign]
    fake.execute = _exec  # type: ignore[method-assign]

    async def override_get_conn():
        yield fake

    app.dependency_overrides[deps.db.get_conn] = override_get_conn
    try:
        body = json.dumps({
            "paperId": "00000000-0000-0000-0000-000000000002",
            "chunks": [
                {"chunkIndex": 0, "content": "hello", "pageStart": 1, "pageEnd": 1, "tokenCount": 1},
            ],
        }).encode()
        r = client.post(
            "/agents/embed-chunks",
            content=body,
            headers=_signed_headers("POST", "/agents/embed-chunks", body),
        )
        assert r.status_code == 200
        assert saw_tx["value"], "handler never opened a conn.transaction()"
    finally:
        app.dependency_overrides.clear()
