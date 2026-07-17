"""GSD-221 — old-schema E2E of the GSD-216 constraint-agnostic upserts.

Migration 0061 swaps the PRIMARY KEY of ``agent_message_metadata`` (to
``user_id, thread_id, message_id, kind``) and ``agent_thread_papers`` (to
``user_id, thread_id, paper_id``). During the migrate+deploy window prod is
briefly on the OLD (pre-0061, no-leading-user_id) PK while the agents service
already runs the tolerant upserts. This test drives the REAL upsert helpers
(``lib.message_metadata.persist_message_metadata`` and
``lib.thread_paper.stamp_thread_paper_association``) against a live throwaway
Postgres, once per schema variant, and asserts:

  * insert then upsert the same key -> no exception, exactly ONE row,
    second call UPDATED the payload (message_metadata) / stayed idempotent
    (thread_papers).

Because both helpers swallow DB errors (best-effort SSE writers), a silent
IntegrityError would look identical to success at the row level unless we
also fail on any swallowed exception. We monkeypatch each helper's
``logger.exception`` to re-raise, so a mismatched ON CONFLICT arbiter (or any
other DB error) surfaces as a hard test failure instead of a false PASS.

Requires a Postgres reachable via ``GSD221_MMD_DSN`` with the two agent
tables pre-created at the target PK shape (``GSD221_VARIANT``). Skips when the
env var is unset so the suite stays green in CI without a live DB. Provision a
throwaway DB per variant (old-PK / new-PK) and run this file once against each.
"""
from __future__ import annotations

import json
import os
import uuid

import asyncpg
import pytest
import pytest_asyncio

from deps import db as db_module
from lib import message_metadata, thread_paper

_DSN_MMD = os.environ.get("GSD221_MMD_DSN")  # message_metadata / thread_paper DB
_VARIANT = os.environ.get("GSD221_VARIANT", "unknown")

pytestmark = pytest.mark.skipif(
    not _DSN_MMD,
    reason="GSD221_MMD_DSN not set — live throwaway Postgres required",
)


@pytest_asyncio.fixture
async def pool():
    p = await asyncpg.create_pool(dsn=_DSN_MMD, min_size=1, max_size=2)
    # Clean slate for a deterministic single-row assertion.
    async with p.acquire() as conn:
        await conn.execute("TRUNCATE agent_message_metadata")
        await conn.execute("TRUNCATE agent_thread_papers")
    prev = db_module._pool
    db_module._pool = p
    try:
        yield p
    finally:
        db_module._pool = prev
        await p.close()


@pytest.fixture(autouse=True)
def _surface_swallowed_errors(monkeypatch):
    """Make both helpers RE-RAISE instead of log-and-swallow.

    Guards against a false PASS: any DB error the helper would normally
    swallow (a bad column, a type mismatch, or — on a hypothetical arbiter
    variant — a mismatched ON CONFLICT target) leaves the row untouched while
    the call still returns 'successfully'. Re-raising turns that into a fail.
    Empirically red-green verified by injecting a bad UPDATE column.
    """
    def _boom(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError(f"helper swallowed a DB error [{_VARIANT}]: {args!r}")

    monkeypatch.setattr(message_metadata.logger, "exception", _boom)
    monkeypatch.setattr(thread_paper.logger, "exception", _boom)


@pytest.mark.asyncio
async def test_message_metadata_insert_then_update(pool):
    thread_id = "th-gsd221"
    user_id = "user_a"
    message_id = "m-1"
    kind = "citations"

    # 1) INSERT path.
    await message_metadata.persist_message_metadata(
        thread_id=thread_id, user_id=user_id, message_id=message_id,
        kind=kind, payload={"v": 1},
    )
    # 2) UPDATE path — same key, new payload.
    await message_metadata.persist_message_metadata(
        thread_id=thread_id, user_id=user_id, message_id=message_id,
        kind=kind, payload={"v": 2},
    )

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT payload FROM agent_message_metadata "
            "WHERE thread_id=$1 AND user_id=$2 AND message_id=$3 AND kind=$4",
            thread_id, user_id, message_id, kind,
        )
    assert len(rows) == 1, f"[{_VARIANT}] expected 1 row, got {len(rows)} (dup?)"
    got = rows[0]["payload"]
    if isinstance(got, str):  # asyncpg returns jsonb as str without a codec
        got = json.loads(got)
    assert got == {"v": 2}, f"[{_VARIANT}] update path did not overwrite payload: {got}"


@pytest.mark.asyncio
async def test_thread_paper_insert_then_reupsert(pool):
    thread_id = "th-gsd221"
    paper_id = str(uuid.uuid4())
    user_id = "user_a"

    # 1) INSERT.
    await thread_paper.stamp_thread_paper_association(
        thread_id=thread_id, paper_id=paper_id, user_id=user_id,
    )
    # 2) Re-upsert same key — DO NOTHING, must not raise or duplicate.
    await thread_paper.stamp_thread_paper_association(
        thread_id=thread_id, paper_id=paper_id, user_id=user_id,
    )

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT thread_id FROM agent_thread_papers "
            "WHERE thread_id=$1 AND paper_id=$2::uuid AND user_id=$3",
            thread_id, paper_id, user_id,
        )
    assert len(rows) == 1, f"[{_VARIANT}] expected 1 row, got {len(rows)} (dup?)"
