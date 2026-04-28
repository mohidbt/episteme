"""Dev-only: truncate the langgraph ``store`` table to clear poisoned rows.

Stale rows written by older code paths (before serialization stabilized)
can hold non-JSON bytes and crash agent invocations on read.  See
``lib/safe_store.py`` for the runtime defense; this script is the
opt-in cleanup mechanism for dev.

Usage::

    EPISTEME_AGENTS_PG_URL=postgresql://... \\
    CONFIRM_DESTRUCTIVE=1 \\
    uv run python scripts/reset_langgraph_store.py

Both env vars are required; the script aborts otherwise.  Idempotent:
running it twice is a no-op the second time (table already empty).
"""
from __future__ import annotations

import os
import sys

import asyncpg


async def _main() -> int:
    pg_url = os.environ.get("EPISTEME_AGENTS_PG_URL")
    if not pg_url:
        print("ERROR: EPISTEME_AGENTS_PG_URL is not set", file=sys.stderr)
        return 2

    if os.environ.get("CONFIRM_DESTRUCTIVE") != "1":
        print(
            "ERROR: refusing to truncate without CONFIRM_DESTRUCTIVE=1 in env",
            file=sys.stderr,
        )
        return 2

    conn = await asyncpg.connect(pg_url)
    try:
        before = await conn.fetchval("SELECT COUNT(*) FROM store")
        # TRUNCATE is fine here; no FK references the store table in
        # langgraph's schema.  CASCADE is harmless and future-proofs the
        # call if that ever changes.
        await conn.execute("TRUNCATE TABLE store CASCADE")
        after = await conn.fetchval("SELECT COUNT(*) FROM store")
    finally:
        await conn.close()

    print(f"reset_langgraph_store: store rows before={before} after={after}")
    return 0


if __name__ == "__main__":
    import asyncio

    sys.exit(asyncio.run(_main()))
