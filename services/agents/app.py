import logging
import os
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
    km_embed,
    km_complete,
    km_chat,
    pdf_text,
)
from routers import km_agent
from routers import openrouter_catalog

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PostgresSaver / PostgresStore lifecycle
#
# These context managers (if EPISTEME_AGENTS_PG_URL is set) hold a long-lived
# connection for the process lifetime.  We open them once at startup in the
# lifespan hook and cache them on checkpointer.py / store.py module globals so
# that subsequent get_saver() / get_store() calls return the same object
# without re-entering the context manager.
# ---------------------------------------------------------------------------

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

    url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    auto_setup = os.environ.get("EPISTEME_AGENTS_AUTO_SETUP", "1") == "1"
    if url:
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # noqa: PLC0415
            from langgraph.store.postgres.aio import AsyncPostgresStore  # noqa: PLC0415
            import checkpointer as chk_mod  # noqa: PLC0415
            import store as store_mod  # noqa: PLC0415

            async with AsyncPostgresSaver.from_conn_string(url) as saver:
                if auto_setup:
                    await saver.setup()
                else:
                    logger.info("skipping AsyncPostgresSaver setup (EPISTEME_AGENTS_AUTO_SETUP=0)")
                chk_mod._CACHED_SAVER = saver

                async with AsyncPostgresStore.from_conn_string(url) as store_obj:
                    if auto_setup:
                        await store_obj.setup()
                    else:
                        logger.info("skipping AsyncPostgresStore setup (EPISTEME_AGENTS_AUTO_SETUP=0)")
                    store_mod._CACHED_STORE = store_obj

                    logger.info("AsyncPostgresSaver + AsyncPostgresStore opened for process lifetime")
                    yield

                store_mod._CACHED_STORE = None
            chk_mod._CACHED_SAVER = None

        except Exception:
            logger.exception("Failed to open AsyncPostgresSaver/AsyncPostgresStore — falling back to in-memory")
            yield
    else:
        yield

    await close_pool()


app = FastAPI(lifespan=lifespan)


@app.get("/health", tags=["health"])
async def public_health() -> dict:
    """Public liveness probe — used by Vercel cron warmer (no auth required)."""
    return {"ok": True}


app.include_router(health.router)
app.include_router(embeddings.router)
app.include_router(outline.router)
app.include_router(chat.router)
app.include_router(auto_highlight.router)
app.include_router(auto_highlight_rebuild.router)
app.include_router(chandra_segments.router)
app.include_router(km_embed.router)
app.include_router(km_complete.router)
app.include_router(km_chat.router)
app.include_router(pdf_text.router)
app.include_router(km_agent.router)
app.include_router(openrouter_catalog.router)
