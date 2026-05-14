"""One-shot: create langgraph checkpoint + store tables. Run as migrate_only."""
import asyncio
import os
import sys


async def main() -> None:
    url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    if not url:
        sys.exit("EPISTEME_AGENTS_PG_URL required")
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from langgraph.store.postgres.aio import AsyncPostgresStore

    async with AsyncPostgresSaver.from_conn_string(url) as saver:
        await saver.setup()
        print("checkpoint tables ready")
    async with AsyncPostgresStore.from_conn_string(url) as store:
        await store.setup()
        print("store tables ready")


asyncio.run(main())
