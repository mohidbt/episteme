import logging
import os
from typing import Annotated, AsyncIterator
import asyncpg
from fastapi import Depends
from pgvector.asyncpg import register_vector

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    app_dsn = os.environ.get("APP_RUNTIME_DATABASE_URL")
    legacy_dsn = os.environ.get("DATABASE_URL")
    dsn = app_dsn or legacy_dsn
    if not dsn:
        return
    if not app_dsn and legacy_dsn:
        logger.warning(
            "APP_RUNTIME_DATABASE_URL not set — falling back to DATABASE_URL (owner role). B3 cutover incomplete in this environment.",
        )
    _pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=10, init=register_vector)


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_conn() -> AsyncIterator[asyncpg.Connection]:
    assert _pool is not None, "pool not initialised"
    async with _pool.acquire() as conn:
        yield conn


ConnDep = Annotated[asyncpg.Connection, Depends(get_conn)]
