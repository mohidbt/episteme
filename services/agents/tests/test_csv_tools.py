"""Tests for services/agents/tools/data.py — csv_read + csv_write_cell tools.

Mocks the lib.km_http boundary the same way test_notes_backend.py mocks it.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}
FILE_ID = "ps-uuid-1"


@pytest.mark.asyncio
async def test_csv_read_calls_km_get_csv_view(monkeypatch):
    captured: list[tuple[str, str]] = []

    async def fake_get(path, *, user_id):
        captured.append((path, user_id))
        return {
            "file_id": FILE_ID,
            "columns": [{"name": "n_subjects", "description": "..."}],
            "row_refs": [{"paper_id": "p-1"}],
            "cells": {"0:n_subjects": "42"},
        }

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data, "km_get", fake_get, raising=True)

    out = await data.csv_read.ainvoke({"file_id": FILE_ID}, config=CFG)

    assert captured == [(f"/api/papersets/{FILE_ID}/csv-view", USER)]
    assert out["file_id"] == FILE_ID
    assert out["cells"] == {"0:n_subjects": "42"}


@pytest.mark.asyncio
async def test_csv_read_surfaces_km_error(monkeypatch):
    async def fake_get(path, *, user_id):
        return {"error": True, "status": 404, "path": path, "body": {"error": "not_found"}}

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data, "km_get", fake_get, raising=True)

    out = await data.csv_read.ainvoke({"file_id": FILE_ID}, config=CFG)

    # Tools never raise into the LangGraph stream — return structured error.
    assert isinstance(out, dict)
    assert out.get("error") is True
    assert out.get("status") == 404


@pytest.mark.asyncio
async def test_csv_write_cell_calls_enrichment_endpoint(monkeypatch):
    captured: list[tuple[str, bytes, dict]] = []

    class Resp:
        is_success = True
        status_code = 200

        async def aread(self):
            return b"event: done\ndata: {}\n\n"

    async def fake_post(url, *, content, headers):
        captured.append((url, content, headers))
        return Resp()

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data.km_http, "_km_base_url", lambda: "http://km", raising=True)
    monkeypatch.setattr(data.km_http, "_auth_headers", lambda *args: {"auth": "ok"}, raising=True)
    monkeypatch.setattr(data.km_http._client, "post", fake_post, raising=True)

    grounding = {"paper_id": "p-1", "block_ids": ["p-1:7"]}
    out = await data.csv_write_cell.ainvoke(
        {
            "file_id": FILE_ID,
            "row": 0,
            "col": "n_subjects",
            "value": "42",
            "grounding": grounding,
        },
        config=CFG,
    )

    assert out == "ok"
    assert captured == [
        (
            f"http://km/api/papersets/{FILE_ID}/enrich",
            b'{"cells": [{"row_idx": 0, "col_name": "n_subjects"}]}',
            {"auth": "ok"},
        ),
    ]


@pytest.mark.asyncio
async def test_csv_write_cell_allows_private_extract_write(monkeypatch):
    captured: list[tuple[str, dict, str]] = []

    async def fake_patch(path, body, *, user_id):
        captured.append((path, body, user_id))
        return {"id": FILE_ID, "content": "Reference,n_subjects\np-1,42"}

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data, "km_patch", fake_patch, raising=True)

    grounding = {"paper_id": "p-1", "block_ids": ["p-1:7"]}
    out = await data.csv_write_cell.ainvoke(
        {
            "file_id": FILE_ID,
            "row": 0,
            "col": "n_subjects",
            "value": "42",
            "grounding": grounding,
        },
        config={"configurable": {"user_id": USER, "allow_direct_csv_write": True}},
    )

    assert out == "ok"
    assert captured == [
        (
            f"/api/papersets/{FILE_ID}/cells",
            {"row": 0, "col": "n_subjects", "value": "42", "grounding": grounding},
            USER,
        ),
    ]


@pytest.mark.asyncio
async def test_csv_write_cell_surfaces_grounding_error(monkeypatch):
    class Req:
        url = "http://km/api/papersets/ps-uuid-1/enrich"

    class Resp:
        is_success = False
        status_code = 400
        request = Req()
        text = ""

        def json(self):
            return {"error": "unknown_col"}

    async def fake_post(url, *, content, headers):  # noqa: ARG001
        return Resp()

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data.km_http, "_km_base_url", lambda: "http://km", raising=True)
    monkeypatch.setattr(data.km_http, "_auth_headers", lambda *args: {"auth": "ok"}, raising=True)
    monkeypatch.setattr(data.km_http._client, "post", fake_post, raising=True)

    out = await data.csv_write_cell.ainvoke(
        {
            "file_id": FILE_ID,
            "row": 0,
            "col": "n_subjects",
            "value": "42",
            "grounding": {"paper_id": "p-1", "block_ids": []},
        },
        config=CFG,
    )

    # Surface KM-side 400 as a clear string error so the LLM can adapt.
    assert isinstance(out, str)
    assert "unknown_col" in out


def test_data_tools_exported():
    from tools import data  # noqa: PLC0415

    names = {t.name for t in data.TOOLS}
    assert names == {"browse_papersets", "csv_read", "csv_write_cell"}
