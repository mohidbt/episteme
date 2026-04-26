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
)
from routers import km_agent

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


def _init_pg_saver_store() -> tuple:
    """Enter PostgresSaver/PostgresStore context managers once at startup.

    Returns (saver_ctx, store_ctx) context manager objects (or None, None if
    no PG URL is configured).  Callers must __exit__ them at shutdown.
    """
    url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    if not url:
        return None, None

    try:
        from langgraph.checkpoint.postgres import PostgresSaver  # noqa: PLC0415
        from langgraph.store.postgres import PostgresStore  # noqa: PLC0415
        import checkpointer as chk_mod  # noqa: PLC0415
        import store as store_mod  # noqa: PLC0415

        saver_ctx = PostgresSaver.from_conn_string(url)
        saver = saver_ctx.__enter__()
        chk_mod._CACHED_SAVER = saver

        store_ctx = PostgresStore.from_conn_string(url)
        store_obj = store_ctx.__enter__()
        store_mod._CACHED_STORE = store_obj

        logger.info("PostgresSaver + PostgresStore opened for process lifetime")
        return saver_ctx, store_ctx
    except Exception:
        logger.exception("Failed to open PostgresSaver/PostgresStore — falling back to in-memory")
        return None, None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await _reap_orphan_runs(datetime.now(timezone.utc))
    saver_ctx, store_ctx = _init_pg_saver_store()
    yield
    # Cleanly close PostgresSaver / PostgresStore if opened
    if store_ctx is not None:
        try:
            store_ctx.__exit__(None, None, None)
        except Exception:
            logger.exception("Error closing PostgresStore")
    if saver_ctx is not None:
        try:
            saver_ctx.__exit__(None, None, None)
        except Exception:
            logger.exception("Error closing PostgresSaver")
    await close_pool()


app = FastAPI(lifespan=lifespan)
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
app.include_router(km_agent.router)
