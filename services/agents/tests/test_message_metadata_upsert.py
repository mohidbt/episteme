"""GSD-216 Option-C — persist_message_metadata must upsert without naming a
PK-specific arbiter, so it works against BOTH the old (thread_id, message_id,
kind) PK and the new (user_id, thread_id, message_id, kind) PK during the
0061 migrate+deploy window (no 500s from a mismatched ON CONFLICT target).

Portable shape: `INSERT ... ON CONFLICT DO NOTHING` (bare, no arbiter) followed
by a full-key `UPDATE`. The UPDATE is scoped by user_id + thread_id + message_id
+ kind so it stays tenant-safe under either schema.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class _Acquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return None


class _Txn:
    async def __aenter__(self):
        return None

    async def __aexit__(self, exc_type, exc, tb):
        return None


def _pool_with_conn():
    conn = MagicMock()
    conn.execute = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=_Txn())
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=_Acquire(conn))
    return pool, conn


@pytest.mark.asyncio
async def test_persist_metadata_is_constraint_agnostic() -> None:
    from lib import message_metadata

    pool, conn = _pool_with_conn()
    with patch("lib.message_metadata.db_module._pool", pool):
        await message_metadata.persist_message_metadata(
            thread_id="th-1",
            user_id="user_a",
            message_id="m-1",
            kind="citations",
            payload={"n": 1},
        )

    # Two statements: a bare-conflict INSERT then a full-key UPDATE.
    assert conn.execute.await_count == 2
    insert_sql = " ".join(conn.execute.await_args_list[0].args[0].split())
    update_sql = " ".join(conn.execute.await_args_list[1].args[0].split())

    # INSERT must not name an arbiter column list after ON CONFLICT.
    assert "INSERT INTO agent_message_metadata" in insert_sql
    assert "ON CONFLICT DO NOTHING" in insert_sql

    # UPDATE must be scoped by the full new-PK key set (tenant-safe).
    assert update_sql.startswith("UPDATE agent_message_metadata")
    for col in ("user_id", "thread_id", "message_id", "kind"):
        assert col in update_sql
    assert "payload" in update_sql


@pytest.mark.asyncio
async def test_persist_metadata_swallows_db_errors() -> None:
    from lib import message_metadata

    pool, conn = _pool_with_conn()
    conn.execute = AsyncMock(side_effect=RuntimeError("boom"))
    conn.transaction = MagicMock(return_value=_Txn())
    with patch("lib.message_metadata.db_module._pool", pool):
        # Must not raise — metadata writes are best-effort.
        await message_metadata.persist_message_metadata(
            thread_id="th-1",
            user_id="user_a",
            message_id="m-1",
            kind="citations",
            payload={"n": 1},
        )
