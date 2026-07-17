"""Thread→paper association persistence for K8 past-threads-in-reader.

Best-effort writer: failures are logged + swallowed so /invoke SSE never
aborts on a metadata write hiccup. Reads are owner-scoped by user_id.
"""
from __future__ import annotations

import logging

from deps import db as db_module

logger = logging.getLogger(__name__)


async def stamp_thread_paper_association(
    *,
    thread_id: str,
    paper_id: str,
    user_id: str,
) -> None:
    """Upsert thread→paper association. Idempotent within the tenant.

    Best-effort: log + swallow DB errors. paper_id must be a uuid string;
    invalid uuids surface as a logged exception, not a raised error.
    """
    pool = db_module._pool
    if pool is None:
        logger.warning("thread_paper stamp skipped: db pool not initialised")
        return
    if not thread_id or not paper_id or not user_id:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO agent_thread_papers (thread_id, paper_id, user_id)
                VALUES ($1, $2::uuid, $3)
                -- GSD-216: no arbiter column list, so this swallows a violation
                -- of either the old (thread_id, paper_id) PK or the new
                -- (user_id, thread_id, paper_id) PK during the 0061 rollout.
                ON CONFLICT DO NOTHING
                """,
                thread_id,
                paper_id,
                user_id,
            )
    except Exception:  # noqa: BLE001
        logger.exception(
            "stamp_thread_paper failed thread=%s paper=%s",
            thread_id, paper_id,
        )


async def list_threads_for_paper(
    *,
    paper_id: str,
    user_id: str,
    limit: int = 50,
) -> list[dict]:
    """Return [{thread_id, created_at(iso), title}, ...] for (paper_id, user_id).

    Owner-scoped: filters by user_id so thread_ids from other tenants are
    never returned. Empty list on missing pool or DB error.

    N8 — LEFT JOIN agent_threads so the UI can label rows by their derived
    title instead of just a timestamp. `title` may be NULL for legacy threads
    that pre-date the title column being populated; the UI falls back to the
    timestamp in that case.
    """
    pool = db_module._pool
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT atp.thread_id, atp.created_at, at.title
                FROM agent_thread_papers atp
                LEFT JOIN agent_threads at
                  ON at.thread_id = atp.thread_id AND at.user_id = atp.user_id
                WHERE atp.paper_id = $1::uuid AND atp.user_id = $2
                ORDER BY atp.created_at DESC
                LIMIT $3
                """,
                paper_id,
                user_id,
                limit,
            )
    except Exception:  # noqa: BLE001
        logger.exception(
            "list_threads_for_paper failed paper=%s user=%s",
            paper_id, user_id,
        )
        return []
    return [
        {
            "thread_id": r["thread_id"],
            "created_at": r["created_at"].isoformat(),
            "title": r["title"],
        }
        for r in rows
    ]
