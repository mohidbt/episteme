import os
from typing import Annotated, AsyncIterator
import asyncpg
from fastapi import Depends
from pgvector.asyncpg import register_vector

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return
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
