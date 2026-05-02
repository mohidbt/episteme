"""Library search tool returning citation-aware chunks."""
from __future__ import annotations

from dataclasses import asdict, dataclass

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from tools._auth import user_id_from_config


@dataclass
class Citation:
    chunk_id: str
    source_kind: str
    source_id: str
    page: int | None
    snippet: str


def _get_pool():
    from deps import db as db_module

    return db_module._pool


@tool
async def search_library(
    query: str,
    kinds: list[str] | None = None,
    source_ids: list[str] | None = None,
    k: int = 8,
    *,
    config: RunnableConfig,
) -> dict:
    """Search note and paper chunks in the user's library and return citations."""
    user_id = user_id_from_config(config)
    limited_k = max(1, min(int(k or 8), 8))
    pool = _get_pool()
    if pool is None:
        raise RuntimeError("DB pool not initialised")

    rows: list[dict] = []
    async with pool.acquire() as conn:
        note_rows = await conn.fetch(
            "SELECT nc.id::text AS chunk_id, 'note' AS source_kind, nc.note_id::text AS source_id, "
            "NULL::int AS page, nc.content AS snippet "
            "FROM note_chunks nc "
            "JOIN notes n ON n.id = nc.note_id "
            "WHERE n.user_id = $1 AND nc.content ILIKE $2 "
            "LIMIT 24",
            user_id,
            f"%{query}%",
        )
        paper_rows = await conn.fetch(
            "SELECT pc.id::text AS chunk_id, 'paper' AS source_kind, pc.paper_id::text AS source_id, "
            "(pc.metadata->>'page')::int AS page, pc.content AS snippet "
            "FROM paper_chunks pc "
            "JOIN papers p ON p.id = pc.paper_id "
            "WHERE p.user_id = $1 AND pc.content ILIKE $2 "
            "LIMIT 24",
            user_id,
            f"%{query}%",
        )
        rows = [dict(r) for r in note_rows] + [dict(r) for r in paper_rows]

    allowed = set(kinds or ["all"])
    out: list[Citation] = []
    for row in rows:
        if "all" not in allowed and row["source_kind"] not in allowed:
            continue
        if source_ids and row["source_id"] not in set(source_ids):
            continue
        out.append(
            Citation(
                chunk_id=row["chunk_id"],
                source_kind=row["source_kind"],
                source_id=row["source_id"],
                page=row["page"],
                snippet=row["snippet"][:280],
            )
        )
        if len(out) >= limited_k:
            break

    return {"query": query, "k": limited_k, "results": [asdict(c) for c in out]}


TOOLS = [search_library]
