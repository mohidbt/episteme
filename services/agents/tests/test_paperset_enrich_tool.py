"""GSD-54: paperset_enrich batch cell-fill tool.

Wraps POST /api/papersets/{id}/enrich (SSE stream). Computes the cells[]
payload from the (paperset_id, rows?, columns?, mode) args by reading
the paperset via /csv-view.

Destructive-ish: kicks off N cell-LLM calls. require_approval = True.
"""
from __future__ import annotations

import os

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402

import pytest  # noqa: E402

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


def test_paperset_enrich_in_TOOLS():
    from tools import ALL_TOOLS

    assert "paperset_enrich" in {t.name for t in ALL_TOOLS}


def test_paperset_enrich_requires_approval():
    from tools.paperset_enrich import paperset_enrich

    md = getattr(paperset_enrich, "metadata", None) or {}
    assert md.get("require_approval") is True


def _csv_view(rows: int, cols: list[str], filled: dict[str, str] | None = None) -> dict:
    """Build a fake /csv-view payload."""
    return {
        "file_id": "ps1",
        "columns": [{"name": c, "description": ""} for c in cols],
        "row_refs": [{"paper_id": f"p{i}"} for i in range(rows)],
        "cells": filled or {},
    }


def _make_post_mock(captured: dict):
    """Replace km_http._client.post with a stub that records call + returns SSE body."""

    async def fake_aread():
        return b""

    fake_resp = MagicMock()
    fake_resp.is_success = True
    fake_resp.aread = AsyncMock(side_effect=fake_aread)

    async def fake_post(url, *, content, headers):
        captured["url"] = url
        captured["body"] = content
        captured["headers"] = headers
        return fake_resp

    return fake_post


@pytest.mark.asyncio
async def test_paperset_enrich_blank_only_default_fans_all_blanks():
    from tools.paperset_enrich import paperset_enrich
    from lib import km_http

    view = _csv_view(2, ["title", "year"], filled={"0:title": "Foo"})
    captured: dict = {}

    with (
        patch("tools.paperset_enrich.km_get", new=AsyncMock(return_value=view)),
        patch.object(km_http._client, "post", new=_make_post_mock(captured)),
    ):
        out = await paperset_enrich.ainvoke(
            {"paperset_id": "ps1"}, config=CFG
        )

    assert out == {"ok": True, "cells_requested": 3}

    import json as _json
    body = _json.loads(captured["body"].decode())
    cells = body["cells"]
    # Only blanks: (0,year), (1,title), (1,year) — three cells.
    keys = {(c["row_idx"], c["col_name"]) for c in cells}
    assert keys == {(0, "year"), (1, "title"), (1, "year")}


@pytest.mark.asyncio
async def test_paperset_enrich_mode_all_fans_every_cell():
    from tools.paperset_enrich import paperset_enrich
    from lib import km_http

    view = _csv_view(2, ["title"], filled={"0:title": "Foo"})
    captured: dict = {}

    with (
        patch("tools.paperset_enrich.km_get", new=AsyncMock(return_value=view)),
        patch.object(km_http._client, "post", new=_make_post_mock(captured)),
    ):
        await paperset_enrich.ainvoke(
            {"paperset_id": "ps1", "mode": "all"}, config=CFG
        )

    import json as _json
    body = _json.loads(captured["body"].decode())
    keys = {(c["row_idx"], c["col_name"]) for c in body["cells"]}
    # mode=all overrides "0:title" being filled — still re-enriches.
    assert keys == {(0, "title"), (1, "title")}


@pytest.mark.asyncio
async def test_paperset_enrich_with_rows_and_columns_filter():
    from tools.paperset_enrich import paperset_enrich
    from lib import km_http

    view = _csv_view(3, ["title", "year", "venue"])
    captured: dict = {}

    with (
        patch("tools.paperset_enrich.km_get", new=AsyncMock(return_value=view)),
        patch.object(km_http._client, "post", new=_make_post_mock(captured)),
    ):
        await paperset_enrich.ainvoke(
            {
                "paperset_id": "ps1",
                "rows": [0, 2],
                "columns": ["year"],
                "mode": "all",
            },
            config=CFG,
        )

    import json as _json
    body = _json.loads(captured["body"].decode())
    keys = {(c["row_idx"], c["col_name"]) for c in body["cells"]}
    assert keys == {(0, "year"), (2, "year")}


@pytest.mark.asyncio
async def test_paperset_enrich_rejects_unknown_column():
    from tools.paperset_enrich import paperset_enrich

    view = _csv_view(2, ["title"])
    with patch("tools.paperset_enrich.km_get", new=AsyncMock(return_value=view)):
        out = await paperset_enrich.ainvoke(
            {"paperset_id": "ps1", "columns": ["bogus"]}, config=CFG
        )
    assert isinstance(out, dict)
    assert out.get("error") is True


@pytest.mark.asyncio
async def test_paperset_enrich_returns_zero_cells_no_op():
    """When every cell is filled and mode is blank-only, no POST is made."""
    from tools.paperset_enrich import paperset_enrich
    from lib import km_http

    view = _csv_view(1, ["title"], filled={"0:title": "Foo"})
    captured: dict = {}

    with (
        patch("tools.paperset_enrich.km_get", new=AsyncMock(return_value=view)),
        patch.object(km_http._client, "post", new=_make_post_mock(captured)),
    ):
        out = await paperset_enrich.ainvoke(
            {"paperset_id": "ps1"}, config=CFG
        )

    assert out == {"ok": True, "cells_requested": 0, "note": "nothing to enrich"}
    assert "url" not in captured  # POST never fired
