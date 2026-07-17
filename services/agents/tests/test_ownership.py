"""Regression: require_paper_owner must not SELECT dropped columns.

`papers.processing_status` (0000 enum) was superseded by `chandra_status`
(0021) and dropped from the live schema. The ownership guard only needs to
confirm existence + tenant ownership, so it must not reference the dropped
column — otherwise every Read-Paper-path tool (read_paper, pdfs, rag) raises
`column "processing_status" does not exist` at runtime, as seen in the
sec/core-hardening preview.
"""
from __future__ import annotations

import re
from unittest.mock import AsyncMock

import pytest

from lib.ownership import ResourceNotOwned, require_paper_owner


class _SchemaAwareConn:
    """fetchrow raises if the SELECT references a column absent from papers."""

    _LIVE_COLS = {"id", "title", "storage_url", "chandra_status", "user_id"}

    async def fetchrow(self, query, *args):
        m = re.search(r"SELECT\s+(.*?)\s+FROM", query, re.IGNORECASE | re.DOTALL)
        cols = [c.strip() for c in m.group(1).split(",")] if m else []
        for c in cols:
            if c not in self._LIVE_COLS:
                raise Exception(f'column "{c}" does not exist')
        return {"id": args[0], "title": "T", "storage_url": "s3://x"}


@pytest.mark.asyncio
async def test_require_paper_owner_uses_only_live_columns():
    conn = _SchemaAwareConn()
    row = await require_paper_owner(conn, paper_id="p1", user_id="u1")
    assert row["id"] == "p1"


@pytest.mark.asyncio
async def test_require_paper_owner_raises_when_not_owned():
    conn = AsyncMock()
    conn.fetchrow.return_value = None
    with pytest.raises(ResourceNotOwned):
        await require_paper_owner(conn, paper_id="p1", user_id="u1")
