"""Postgres-backed S2 cooldown store, shared across Fluid Compute instances.

Single-row table `s2_cooldown(id=1, until_epoch)`. All operations are
best-effort — DB hiccups must never break the search path. When the
asyncpg pool isn't initialised (no DATABASE_URL, e.g. local tests), the
helpers no-op cleanly.
"""
from __future__ import annotations

import logging

from deps import db as db_module

logger = logging.getLogger(__name__)

_initialised: bool = False

_DDL = """
CREATE TABLE IF NOT EXISTS s2_cooldown (
    id          smallint PRIMARY KEY,
    until_epoch double precision NOT NULL
)
"""


async def _ensure_table() -> bool:
    """Create the table on first use. Returns True if pool is usable."""
    global _initialised
    pool = db_module._pool
    if pool is None:
        return False
    if _initialised:
        return True
    try:
        async with pool.acquire() as conn:
            await conn.execute(_DDL)
        _initialised = True
        return True
    except Exception:
        logger.exception("s2_cooldown DDL failed")
        return False


async def get_cooldown_until() -> float:
    """Return the shared cooldown deadline (epoch seconds), or 0 if none."""
    if not await _ensure_table():
        return 0.0
    try:
        pool = db_module._pool
        assert pool is not None
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT until_epoch FROM s2_cooldown WHERE id = 1"
            )
        return float(row["until_epoch"]) if row else 0.0
    except Exception:
        logger.exception("s2_cooldown read failed")
        return 0.0


async def set_cooldown_until(ts: float) -> None:
    """Best-effort: bump the shared cooldown to max(current, ts)."""
    if not await _ensure_table():
        return
    try:
        pool = db_module._pool
        assert pool is not None
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO s2_cooldown (id, until_epoch) VALUES (1, $1)
                ON CONFLICT (id) DO UPDATE
                  SET until_epoch = GREATEST(s2_cooldown.until_epoch, EXCLUDED.until_epoch)
                """,
                ts,
            )
    except Exception:
        logger.exception("s2_cooldown write failed")
