"""Per-message metadata for agent threads.

Codex follow-ups (post-d4b848f):
  - Module-level task set retains references to fire-and-forget persist
    coroutines so they aren't GC'd mid-flight or "destroyed pending" on
    loop shutdown.
  - fetch_thread_metadata has an internal timeout so /state never blocks
    indefinitely on a DB stall; on timeout it degrades to {} (citations
    re-hydrate next reload).


Generic ``(thread_id, message_id, kind, payload)`` row store. First consumer:
inline citations — but the table is intentionally schema-agnostic so future
per-message extras (grounding, todos snapshot, alternative sources) reuse
the same path without further migrations.

Why a side table and not ``AIMessage.additional_kwargs``: the prior approach
stamped citations onto the checkpoint AIMessage via ``aupdate_state`` and the
``add_messages`` reducer. That coupling broke whenever the SSE ``run_id``
diverged from the eventual checkpoint ``AIMessage.id`` (LangChain code paths
sometimes do, sometimes don't, prefix with ``run--`` or assign a fresh id).
This module decouples persistence from the checkpoint message id system.

Owner column is mandatory — ``thread_id`` is user-supplied at ``/invoke`` and
must NOT be the sole tenant boundary. Both writes and reads are scoped by
``user_id``.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from deps import db as db_module

logger = logging.getLogger(__name__)

CITATIONS_KIND = "citations"

# /state must never block indefinitely on a metadata read — citations are
# best-effort and reload-retriable. 2s is generous for a single-table
# indexed SELECT on Neon.
_FETCH_TIMEOUT_S = 2.0

# Module-level retention for fire-and-forget persist tasks. Without this
# Python's GC can collect an outstanding asyncio.Task while it's still
# running and the SSE generator has returned, producing "Task was destroyed
# but it is pending" warnings and dropped writes.
_pending_persist_tasks: set[asyncio.Task] = set()


def schedule_persist(coro) -> asyncio.Task:
    """Schedule a fire-and-forget persist coroutine with task retention.

    The task is added to a module-level set and removed via done callback,
    so the runtime always holds a strong reference until completion. Use
    this instead of bare ``asyncio.create_task`` for metadata writes.
    """
    task = asyncio.create_task(coro)
    _pending_persist_tasks.add(task)
    task.add_done_callback(_pending_persist_tasks.discard)
    return task


async def persist_message_metadata(
    *,
    thread_id: str,
    user_id: str,
    message_id: str,
    kind: str,
    payload: Any,
) -> None:
    """Upsert a metadata row. Idempotent on (thread_id, message_id, kind).

    Best-effort: DB failures are logged and swallowed so SSE streams never
    abort on a metadata write hiccup. Citations are not billing-critical.
    """
    pool = db_module._pool
    if pool is None:
        logger.warning("metadata persist skipped: db pool not initialised")
        return
    if not message_id:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO agent_message_metadata
                    (thread_id, user_id, message_id, kind, payload)
                VALUES ($1, $2, $3, $4, $5::jsonb)
                ON CONFLICT (thread_id, message_id, kind) DO UPDATE
                  SET payload = EXCLUDED.payload,
                      user_id = EXCLUDED.user_id
                """,
                thread_id,
                user_id,
                message_id,
                kind,
                json.dumps(payload),
            )
    except Exception:  # noqa: BLE001
        logger.exception(
            "metadata persist failed thread_id=%s msg_id=%s kind=%s",
            thread_id, message_id, kind,
        )


async def fetch_thread_metadata(
    *,
    thread_id: str,
    user_id: str,
) -> dict[tuple[str, str], Any]:
    """Load all metadata rows for one thread, filtered by user_id.

    Returns ``{(message_id, kind): payload}``. Empty dict on missing pool or
    DB error — callers degrade gracefully (no citations on reload rather
    than a broken /state response).
    """
    pool = db_module._pool
    if pool is None:
        return {}

    async def _do_fetch() -> list:
        async with pool.acquire() as conn:
            return await conn.fetch(
                """
                SELECT message_id, kind, payload
                FROM agent_message_metadata
                WHERE thread_id = $1 AND user_id = $2
                """,
                thread_id,
                user_id,
            )

    try:
        rows = await asyncio.wait_for(_do_fetch(), timeout=_FETCH_TIMEOUT_S)
    except asyncio.TimeoutError:
        logger.warning(
            "metadata fetch timed out thread_id=%s user_id=%s budget=%.1fs",
            thread_id, user_id, _FETCH_TIMEOUT_S,
        )
        return {}
    except Exception:  # noqa: BLE001
        logger.exception(
            "metadata fetch failed thread_id=%s user_id=%s",
            thread_id, user_id,
        )
        return {}

    out: dict[tuple[str, str], Any] = {}
    for r in rows:
        payload = r["payload"]
        # asyncpg returns jsonb as str unless a codec is registered.
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (TypeError, ValueError):
                continue
        out[(r["message_id"], r["kind"])] = payload
    return out
