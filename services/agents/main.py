import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from deps import db as db_module
from deps.db import init_pool, close_pool
from routers import (
    health,
    embeddings,
    outline,
    chat,
    auto_highlight,
    auto_highlight_rebuild,
    chandra_segments,
)

logger = logging.getLogger(__name__)


async def _reap_orphan_runs(boot_time: datetime) -> None:
    """Mark ai_highlight_runs rows left in 'running' by a prior process as failed."""
    pool = db_module._pool
    if pool is None:
        return
    async with pool.acquire() as conn:
        status = await conn.execute(
            "UPDATE ai_highlight_runs SET status = 'failed', completed_at = now() "
            "WHERE status = 'running' AND created_at < $1",
            boot_time,
        )
    # asyncpg execute() returns e.g. "UPDATE 3"
    reaped = int(status.rsplit(" ", 1)[-1]) if status.startswith("UPDATE ") else 0
    if reaped:
        logger.info("reaped %d orphan ai_highlight_runs row(s)", reaped)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await _reap_orphan_runs(datetime.now(timezone.utc))
    yield
    await close_pool()


app = FastAPI(lifespan=lifespan)
app.include_router(health.router)
app.include_router(embeddings.router)
app.include_router(outline.router)
app.include_router(chat.router)
app.include_router(auto_highlight.router)
app.include_router(auto_highlight_rebuild.router)
app.include_router(chandra_segments.router)
