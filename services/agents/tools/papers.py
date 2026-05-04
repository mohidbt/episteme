"""LangChain tool: read_paper — minimal scoped slice over document_segments.

The agent calls this tool to fetch ONLY the part of a paper relevant to a
specific cell-extraction prompt. Five scope kinds:
  - sections : window over headers (`Methods`, `Results`, …)
  - blocks   : filter by kind (`table`, `figure`, …)
  - pages    : page-range cut
  - rag      : FTS over payload text (vector path TODO once paper_embeddings populated)
  - full     : whole document (capped at MAX_FULL_TOKENS)

BEFORE any segment query, ``ensure_parsed`` is awaited so a paper that has
not yet been Chandra-parsed is parsed lazily. On parse failure we raise
``ChandraParseFailed`` — the agent surfaces the error to the user and does
NOT fabricate values.

Runtime context required in ``RunnableConfig.configurable``:
  - ``user_id``  : authenticated user (currently unused for paper reads but
                   kept consistent with other tools' contract).
  - ``ocr_key``  : Datalab OCR key (forwarded to ``ensure_parsed``).

After 1.6a, ``document_segments`` is keyed on ``paper_id uuid`` referencing
``papers.id`` directly.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Literal, TypedDict

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.chandra import ChandraParseFailed, ensure_parsed

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public types (per spec §9.2).
# ---------------------------------------------------------------------------


class PaperScope(TypedDict, total=False):
    kind: Literal["sections", "blocks", "pages", "rag", "full"]
    names: list[str] | None
    types: list[str] | None
    # `tuple[int, int] | None` produces an `anyOf` whose array branch lacks
    # `items`, which strict OpenAI-style validators (e.g. OpenRouter Azure
    # provider) reject as `array schema missing items`. Use `list[int]` with
    # a 2-element convention (rng[0]=lo, rng[1]=hi).
    range: list[int] | None
    query: str | None
    top_k: int | None


class PaperBlock(TypedDict):
    block_id: str
    kind: str
    section: str | None
    page: int
    text: str


class PaperSlice(TypedDict):
    paper_id: str
    blocks: list[PaperBlock]
    truncated: bool
    token_count: int


# ---------------------------------------------------------------------------
# Tunables.
# ---------------------------------------------------------------------------

MAX_TOKENS_DEFAULT = 5000
MAX_FULL_TOKENS = 20000


# ---------------------------------------------------------------------------
# Internal helpers.
# ---------------------------------------------------------------------------


def _get_pool():
    """Indirection so tests can monkeypatch the pool."""
    from deps import db as db_module

    return db_module._pool


def _ocr_key_from_config(config: RunnableConfig | None) -> str:
    cfg = (config or {}).get("configurable") or {}
    ocr_key = cfg.get("ocr_key")
    if not ocr_key:
        raise ValueError(
            "tool invoked without configurable.ocr_key — agent factory must "
            "inject ocr_key into RunnableConfig (see services/agents/routers/km_agent.py)"
        )
    return ocr_key


def _payload_text(kind: str, payload: dict[str, Any]) -> str:
    if kind == "section_header":
        return payload.get("text", "") or ""
    if kind == "paragraph":
        return payload.get("text", "") or ""
    if kind == "figure":
        return payload.get("caption", "") or ""
    if kind == "formula":
        return payload.get("latex", "") or ""
    if kind == "table":
        return payload.get("text") or payload.get("html") or ""
    return payload.get("text", "") or ""


def _row_to_block(row, paper_id: str, header_lookup: dict[int, str]) -> PaperBlock:
    payload_raw = row["payload"]
    payload = json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
    kind = row["kind"]
    order_index = row["order_index"]
    text = _payload_text(kind, payload or {})

    # Find nearest preceding section_header by order_index.
    section: str | None = None
    for header_oi in sorted(header_lookup.keys(), reverse=True):
        if header_oi <= order_index:
            section = header_lookup[header_oi]
            break

    return {
        "block_id": f"{paper_id}:p{row['page']}:{order_index}",
        "kind": kind,
        "section": section,
        "page": row["page"],
        "text": text,
    }


def _token_estimate(text: str) -> int:
    """Rough token estimate: len(text) // 4 (matches spec MVP heuristic)."""
    return len(text) // 4


async def _load_header_lookup(conn, paper_id: str) -> dict[int, str]:
    """Map order_index → section_header text for `section` resolution."""
    rows = await conn.fetch(
        """
        SELECT order_index, payload
          FROM document_segments
         WHERE paper_id = $1
           AND kind = 'section_header'
         ORDER BY order_index
        """,
        paper_id,
    )
    out: dict[int, str] = {}
    for r in rows:
        payload_raw = r["payload"]
        payload = json.loads(payload_raw) if isinstance(payload_raw, str) else payload_raw
        out[r["order_index"]] = (payload or {}).get("text", "") or ""
    return out


# ---------------------------------------------------------------------------
# Scope dispatchers — each returns a list of asyncpg rows.
# ---------------------------------------------------------------------------


async def _query_sections(conn, paper_id: str, names: list[str]) -> list:
    """Return all rows from each matching section_header (inclusive) up to but
    excluding the next section_header, ordered by order_index.
    """
    if not names:
        return []
    pattern_args = [f"%{n}%" for n in names]
    return await conn.fetch(
        """
        WITH headers AS (
          SELECT order_index, payload
            FROM document_segments
           WHERE paper_id = $1
             AND kind = 'section_header'
        ),
        matched AS (
          SELECT order_index AS start_oi
            FROM headers
           WHERE EXISTS (
             SELECT 1 FROM unnest($2::text[]) p
              WHERE payload->>'text' ILIKE p
           )
        ),
        windows AS (
          SELECT m.start_oi,
                 (SELECT MIN(h.order_index)
                    FROM headers h
                   WHERE h.order_index > m.start_oi) AS end_oi
            FROM matched m
        )
        SELECT s.order_index, s.kind, s.page, s.payload
          FROM document_segments s
          JOIN windows w
            ON s.order_index >= w.start_oi
           AND (w.end_oi IS NULL OR s.order_index < w.end_oi)
         WHERE s.paper_id = $1
         ORDER BY s.order_index
        """,
        paper_id,
        pattern_args,
    )


async def _query_blocks(conn, paper_id: str, types: list[str]) -> list:
    return await conn.fetch(
        """
        SELECT order_index, kind, page, payload
          FROM document_segments
         WHERE paper_id = $1
           AND kind = ANY($2::text[])
         ORDER BY order_index
        """,
        paper_id,
        types,
    )


async def _query_pages(conn, paper_id: str, lo: int, hi: int) -> list:
    return await conn.fetch(
        """
        SELECT order_index, kind, page, payload
          FROM document_segments
         WHERE paper_id = $1
           AND page BETWEEN $2 AND $3
         ORDER BY order_index
        """,
        paper_id,
        lo,
        hi,
    )


async def _query_rag_fts(conn, paper_id: str, query: str, top_k: int) -> list:
    # TODO(1.5): vector path — query paper_embeddings if rows exist.
    return await conn.fetch(
        """
        SELECT order_index, kind, page, payload,
               ts_rank(
                 to_tsvector('english', coalesce(payload->>'text', payload->>'caption', payload->>'latex', '')),
                 plainto_tsquery('english', $2)
               ) AS rank
          FROM document_segments
         WHERE paper_id = $1
           AND to_tsvector('english', coalesce(payload->>'text', payload->>'caption', payload->>'latex', ''))
               @@ plainto_tsquery('english', $2)
         ORDER BY rank DESC
         LIMIT $3
        """,
        paper_id,
        query,
        top_k,
    )


async def _query_full(conn, paper_id: str) -> list:
    return await conn.fetch(
        """
        SELECT order_index, kind, page, payload
          FROM document_segments
         WHERE paper_id = $1
         ORDER BY order_index
        """,
        paper_id,
    )


def _truncate_to_cap(blocks: list[PaperBlock], cap: int) -> tuple[list[PaperBlock], bool, int]:
    """Truncate block list to fit under `cap` tokens. Return (kept, truncated, token_count)."""
    kept: list[PaperBlock] = []
    total = 0
    truncated = False
    for b in blocks:
        cost = _token_estimate(b["text"])
        if total + cost > cap:
            truncated = True
            break
        kept.append(b)
        total += cost
    return kept, truncated, total


# ---------------------------------------------------------------------------
# Tool entry point.
# ---------------------------------------------------------------------------


@tool
async def read_paper(
    paper_id: str,
    scope: PaperScope,
    *,
    config: RunnableConfig,
) -> PaperSlice:
    """Return a minimal, scope-filtered slice of a paper's parsed segments.

    Triggers Chandra parsing lazily (via ensure_parsed) on first read. Token-
    capped at 5000 by default; ``kind="full"`` raises the cap to 20000.

    Use the smallest scope that answers the question:
      - ``kind="sections", names=["Methods"]`` — when the answer lives in a section.
      - ``kind="blocks", types=["table"]``    — when the answer is structural.
      - ``kind="pages", range=(3, 5)``        — when the user points at pages.
      - ``kind="rag", query="...", top_k=5``  — for cross-section / vague prompts.
      - ``kind="full"``                       — last resort; cap 20k tokens.

    Args:
        paper_id: Paper UUID.
        scope: Scope dict (see PaperScope).
    """
    ocr_key = _ocr_key_from_config(config)
    pool = _get_pool()
    if pool is None:
        raise RuntimeError("DB pool not initialised — call deps.db.init_pool() first")

    async with pool.acquire() as conn:
        # Lazy Chandra parse. Raises ChandraParseFailed loudly on failure.
        await ensure_parsed(paper_id, conn, ocr_key)

        kind = scope.get("kind", "full")
        if kind == "sections":
            names = scope.get("names") or []
            rows = await _query_sections(conn, paper_id, names)
        elif kind == "blocks":
            types = scope.get("types") or []
            rows = await _query_blocks(conn, paper_id, types)
        elif kind == "pages":
            rng = scope.get("range") or (0, 0)
            rows = await _query_pages(conn, paper_id, rng[0], rng[1])
        elif kind == "rag":
            query = scope.get("query") or ""
            top_k = scope.get("top_k") or 10
            rows = await _query_rag_fts(conn, paper_id, query, top_k)
        elif kind == "full":
            rows = await _query_full(conn, paper_id)
        else:
            raise ValueError(f"unknown scope kind: {kind!r}")

        header_lookup = await _load_header_lookup(conn, paper_id)

    blocks = [_row_to_block(r, paper_id, header_lookup) for r in rows]
    cap = MAX_FULL_TOKENS if kind == "full" else MAX_TOKENS_DEFAULT
    blocks, truncated, token_count = _truncate_to_cap(blocks, cap)

    return {
        "paper_id": paper_id,
        "blocks": blocks,
        "truncated": truncated,
        "token_count": token_count,
    }


TOOLS = [read_paper]
