"""
Tests for services/agents/tools/papers.py — read_paper tool (1.4.x T3).

DB connection is mocked at the same boundary used by test_chandra_lib.py:
an AsyncMock conn with .fetch / .fetchval / .fetchrow side effects, and a
patched deps.db._pool whose .acquire() yields it.
"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lib.chandra import ChandraParseFailed
from tools.papers import (
    MAX_FULL_TOKENS,
    MAX_TOKENS_DEFAULT,
    read_paper,
)

PAPER_ID = "11111111-1111-1111-1111-111111111111"


# ---------------------------------------------------------------------------
# Test fixtures: an in-memory list of "document_segments rows" for paper.
# ---------------------------------------------------------------------------

# Each row is a dict mirroring the asyncpg row interface.
def _row(order_index, kind, page, payload, paper_id=PAPER_ID):
    return {
        "order_index": order_index,
        "kind": kind,
        "page": page,
        "payload": json.dumps(payload),
        "paper_id": paper_id,
    }


SEGMENTS_FIXTURE = [
    _row(0, "section_header", 1, {"text": "Introduction", "heading_level": 1}),
    _row(1, "paragraph", 1, {"text": "Intro body text."}),
    _row(2, "section_header", 2, {"text": "Methods", "heading_level": 1}),
    _row(3, "paragraph", 2, {"text": "We used a transformer model."}),
    _row(4, "table", 3, {"text": "Table 1 contents", "html": "<table></table>"}),
    _row(5, "section_header", 4, {"text": "Results", "heading_level": 1}),
    _row(6, "figure", 4, {"caption": "Figure 1: results plot."}),
    _row(7, "formula", 5, {"latex": "E=mc^2"}),
    _row(8, "paragraph", 5, {"text": "Conclusion paragraph."}),
]


def _make_conn(rows=SEGMENTS_FIXTURE):
    """Build a stateful AsyncMock conn that returns segment rows."""
    conn = AsyncMock()

    async def fetch(sql, *args):
        # Identify query path by SQL substring; return matching rows.
        # Header lookup: only section_header rows.
        if "kind = 'section_header'" in sql and "ILIKE" not in sql:
            return [r for r in rows if r["kind"] == "section_header"]
        # Sections: window between section_header rows.
        if "section_header" in sql and "ILIKE" in sql:
            raw_names = args[1] if len(args) > 1 else []
            # Mock receives ILIKE patterns like "%Methods%"; strip wildcards for substring match.
            names = [n.strip("%") for n in raw_names]
            # Find section_header rows whose payload->>'text' matches any name (case-insensitive substring).
            matched_starts = []
            for r in rows:
                if r["kind"] == "section_header":
                    payload_text = json.loads(r["payload"]).get("text", "")
                    if any(n.lower() in payload_text.lower() for n in names):
                        matched_starts.append(r["order_index"])
            out = []
            sorted_headers = sorted(
                [r["order_index"] for r in rows if r["kind"] == "section_header"]
            )
            for start in matched_starts:
                idx = sorted_headers.index(start)
                end = sorted_headers[idx + 1] if idx + 1 < len(sorted_headers) else None
                for r in rows:
                    if r["order_index"] >= start and (end is None or r["order_index"] < end):
                        out.append(r)
            return sorted(out, key=lambda r: r["order_index"])
        if "kind = ANY" in sql:
            types = args[1]
            return [r for r in rows if r["kind"] in types]
        if "page BETWEEN" in sql:
            lo, hi = args[1], args[2]
            return [r for r in rows if lo <= r["page"] <= hi]
        if "ts_rank" in sql or "plainto_tsquery" in sql:
            query = args[1]
            top_k = args[2]
            # Naive FTS: rows whose text contains the query token.
            matched = []
            for r in rows:
                payload = json.loads(r["payload"])
                text = payload.get("text") or payload.get("caption") or payload.get("latex") or ""
                if query.lower() in text.lower():
                    matched.append(r)
            return matched[:top_k]
        if "ORDER BY order_index" in sql:
            # full / generic
            return list(rows)
        return []

    async def fetchval(sql, *args):
        if "paper_embeddings" in sql:
            return 0  # No embeddings — force FTS fallback.
        return None

    conn.fetch.side_effect = fetch
    conn.fetchval.side_effect = fetchval
    return conn


@asynccontextmanager
async def _fake_acquire(conn):
    yield conn


def _patch_pool_and_ensure(conn):
    """Patch the asyncpg pool + ensure_parsed to be a no-op."""
    pool = MagicMock()
    pool.acquire = lambda: _fake_acquire(conn)

    return patch.multiple(
        "tools.papers",
        _get_pool=MagicMock(return_value=pool),
        ensure_parsed=AsyncMock(return_value="done"),
    )


def _config(ocr_key="ck-test"):
    return {"configurable": {"user_id": "u1", "ocr_key": ocr_key}}


# ---------------------------------------------------------------------------
# Scope dispatch tests.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_read_paper_sections_returns_methods_window():
    """kind=sections, names=['Methods'] returns Methods header + body rows up to Results."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "sections", "names": ["Methods"]}},
            config=_config(),
        )
    block_ids = [b["block_id"] for b in result["blocks"]]
    # Should be order_index 2, 3, 4 (Methods header + paragraph + table) — stops before Results (5).
    assert block_ids == [f"{PAPER_ID}:2", f"{PAPER_ID}:3", f"{PAPER_ID}:4"]
    assert result["paper_id"] == PAPER_ID
    assert result["truncated"] is False


@pytest.mark.asyncio
async def test_read_paper_blocks_table_filter():
    """kind=blocks, types=['table'] returns only tables."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "blocks", "types": ["table"]}},
            config=_config(),
        )
    assert all(b["kind"] == "table" for b in result["blocks"])
    assert len(result["blocks"]) == 1
    assert result["blocks"][0]["block_id"] == f"{PAPER_ID}:4"
    assert result["blocks"][0]["text"] == "Table 1 contents"


@pytest.mark.asyncio
async def test_read_paper_pages_range():
    """kind=pages, range=(3,5) filters by page."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "pages", "range": (3, 5)}},
            config=_config(),
        )
    pages = {b["page"] for b in result["blocks"]}
    assert pages <= {3, 4, 5}
    assert pages == {3, 4, 5}


@pytest.mark.asyncio
async def test_read_paper_full_truncation():
    """kind=full caps at MAX_FULL_TOKENS with truncated=True when over budget."""
    # Build a fixture huge enough to overflow MAX_FULL_TOKENS (20000).
    big_text = "x" * 1000  # ~250 tokens per row
    rows = [_row(i, "paragraph", 1, {"text": big_text}) for i in range(200)]  # ~50000 tokens
    conn = _make_conn(rows)
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "full"}},
            config=_config(),
        )
    assert result["truncated"] is True
    assert result["token_count"] <= MAX_FULL_TOKENS
    # Sanity: at least some blocks returned.
    assert len(result["blocks"]) > 0
    assert len(result["blocks"]) < 200


@pytest.mark.asyncio
async def test_read_paper_default_cap_is_smaller_than_full():
    """Non-full scopes use MAX_TOKENS_DEFAULT (5000) cap."""
    big_text = "x" * 1000
    rows = [_row(i, "paragraph", 1, {"text": big_text}) for i in range(100)]
    conn = _make_conn(rows)
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "blocks", "types": ["paragraph"]}},
            config=_config(),
        )
    assert result["truncated"] is True
    assert result["token_count"] <= MAX_TOKENS_DEFAULT


@pytest.mark.asyncio
async def test_read_paper_rag_fts_fallback():
    """kind=rag falls back to FTS when paper_embeddings table empty/missing."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {
                "paper_id": PAPER_ID,
                "scope": {"kind": "rag", "query": "transformer", "top_k": 5},
            },
            config=_config(),
        )
    # Only the methods paragraph contains "transformer".
    assert len(result["blocks"]) == 1
    assert "transformer" in result["blocks"][0]["text"].lower()


@pytest.mark.asyncio
async def test_read_paper_block_id_format():
    """Every block has block_id = f'{paper_id}:{order_index}'."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "full"}},
            config=_config(),
        )
    for b in result["blocks"]:
        prefix, idx = b["block_id"].split(":")
        assert prefix == PAPER_ID
        assert idx.isdigit()


@pytest.mark.asyncio
async def test_read_paper_section_resolved_for_paragraph():
    """Each block carries the nearest preceding section_header text as `section`."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "blocks", "types": ["paragraph"]}},
            config=_config(),
        )
    # paragraph at order_index=3 lives under Methods.
    by_idx = {b["block_id"]: b for b in result["blocks"]}
    assert by_idx[f"{PAPER_ID}:3"]["section"] == "Methods"


@pytest.mark.asyncio
async def test_read_paper_text_resolution_per_kind():
    """text is resolved from payload per kind: paragraph→text, figure→caption, formula→latex."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        result = await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "full"}},
            config=_config(),
        )
    by_idx = {b["block_id"]: b for b in result["blocks"]}
    assert by_idx[f"{PAPER_ID}:3"]["text"] == "We used a transformer model."  # paragraph.text
    assert by_idx[f"{PAPER_ID}:6"]["text"] == "Figure 1: results plot."        # figure.caption
    assert by_idx[f"{PAPER_ID}:7"]["text"] == "E=mc^2"                          # formula.latex


# ---------------------------------------------------------------------------
# ensure_parsed integration.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_read_paper_calls_ensure_parsed_first():
    """read_paper awaits ensure_parsed BEFORE querying segments."""
    conn = _make_conn()
    pool = MagicMock()
    pool.acquire = lambda: _fake_acquire(conn)

    with patch("tools.papers._get_pool", MagicMock(return_value=pool)), \
         patch("tools.papers.ensure_parsed", new_callable=AsyncMock) as mock_ensure:
        mock_ensure.return_value = "done"
        await read_paper.ainvoke(
            {"paper_id": PAPER_ID, "scope": {"kind": "full"}},
            config=_config(),
        )
    mock_ensure.assert_awaited_once()
    args = mock_ensure.await_args.args
    assert args[0] == PAPER_ID
    # ocr_key is third positional arg
    assert args[2] == "ck-test"


@pytest.mark.asyncio
async def test_read_paper_propagates_chandra_parse_failed():
    """ensure_parsed raising ChandraParseFailed propagates loudly — no fabrication."""
    conn = _make_conn()
    pool = MagicMock()
    pool.acquire = lambda: _fake_acquire(conn)

    with patch("tools.papers._get_pool", MagicMock(return_value=pool)), \
         patch("tools.papers.ensure_parsed", new_callable=AsyncMock,
               side_effect=ChandraParseFailed("status='failed'")):
        with pytest.raises(ChandraParseFailed):
            await read_paper.ainvoke(
                {"paper_id": PAPER_ID, "scope": {"kind": "full"}},
                config=_config(),
            )


@pytest.mark.asyncio
async def test_read_paper_missing_ocr_key_raises():
    """Missing ocr_key in RunnableConfig raises loud — never silent skip."""
    conn = _make_conn()
    with _patch_pool_and_ensure(conn):
        with pytest.raises(ValueError, match="ocr_key"):
            await read_paper.ainvoke(
                {"paper_id": PAPER_ID, "scope": {"kind": "full"}},
                config={"configurable": {"user_id": "u1"}},  # no ocr_key
            )


# ---------------------------------------------------------------------------
# Registration.
# ---------------------------------------------------------------------------


def test_read_paper_in_all_tools():
    """read_paper is registered in tools.ALL_TOOLS."""
    from tools import ALL_TOOLS

    names = [t.name for t in ALL_TOOLS]
    assert "read_paper" in names
