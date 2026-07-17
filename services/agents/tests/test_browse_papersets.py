"""Tests for browse_papersets tool in services/agents/tools/data.py.

Mocks the lib.km_http boundary the same way test_csv_tools.py mocks it.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


# ---------------------------------------------------------------------------
# 1. Tool returns list of papersets with schema
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_browse_papersets_returns_list_with_schema(monkeypatch):
    """browse_papersets calls GET /api/papersets and returns the raw response
    which includes id, filename, rowRefs, and columns for each paperset."""
    captured: list[tuple[str, str]] = []

    async def fake_get(path, *, user_id):
        captured.append((path, user_id))
        return [
            {
                "id": "ps-1",
                "filename": "extract-v1.csv",
                "rowRefs": [{"paper_id": "p-1"}, {"paper_id": "p-2"}],
                "columns": [
                    {"name": "n_subjects", "description": "Number of subjects"},
                    {"name": "method", "description": "Method used"},
                ],
            },
            {
                "id": "ps-2",
                "filename": "survey.csv",
                "rowRefs": [],
                "columns": [{"name": "result", "description": "Key result"}],
            },
        ]

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data, "km_get", fake_get, raising=True)

    out = await data.browse_papersets.ainvoke({}, config=CFG)

    assert captured == [("/api/papersets", USER)]
    assert isinstance(out, list)
    assert len(out) == 2
    assert out[0]["id"] == "ps-1"
    assert out[0]["filename"] == "extract-v1.csv"
    assert len(out[0]["rowRefs"]) == 2
    assert len(out[0]["columns"]) == 2
    assert out[0]["columns"][0]["name"] == "n_subjects"
    assert out[1]["id"] == "ps-2"
    assert out[1]["rowRefs"] == []


# ---------------------------------------------------------------------------
# 2. Tool handles empty papersets gracefully
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_browse_papersets_empty_list(monkeypatch):
    """When the user has no papersets, returns an empty list."""
    async def fake_get(path, *, user_id):
        return []

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data, "km_get", fake_get, raising=True)

    out = await data.browse_papersets.ainvoke({}, config=CFG)

    assert out == []


# ---------------------------------------------------------------------------
# 3. Tool surfaces KM errors (never raises into LangGraph stream)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_browse_papersets_surfaces_km_error(monkeypatch):
    async def fake_get(path, *, user_id):
        return {"error": True, "status": 500, "path": path, "body": {"error": "internal"}}

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data, "km_get", fake_get, raising=True)

    out = await data.browse_papersets.ainvoke({}, config=CFG)

    assert isinstance(out, dict)
    assert out.get("error") is True
    assert out.get("status") == 500


# ---------------------------------------------------------------------------
# 4. Tool chains: browse output contains file_id usable by csv_read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_browse_papersets_output_chains_with_csv_read(monkeypatch):
    """The id field from browse_papersets output can be passed to csv_read."""
    ps_id = "ps-chain-1"

    async def fake_browse_get(path, *, user_id):
        return [
            {
                "id": ps_id,
                "filename": "chain-test.csv",
                "rowRefs": [{"paper_id": "p-1"}],
                "columns": [{"name": "val", "description": "value"}],
            },
        ]

    csv_captured: list[tuple[str, str]] = []

    async def fake_csv_get(path, *, user_id):
        csv_captured.append((path, user_id))
        return {
            "file_id": ps_id,
            "columns": [{"name": "val", "description": "value"}],
            "row_refs": [{"paper_id": "p-1"}],
            "cells": {},
        }

    from tools import data  # noqa: PLC0415
    monkeypatch.setattr(data, "km_get", fake_csv_get, raising=True)

    # First browse
    monkeypatch.setattr(data, "km_get", fake_browse_get, raising=True)
    browse_out = await data.browse_papersets.ainvoke({}, config=CFG)
    file_id = browse_out[0]["id"]

    # Then csv_read with the id from browse
    monkeypatch.setattr(data, "km_get", fake_csv_get, raising=True)
    csv_out = await data.csv_read.ainvoke({"file_id": file_id}, config=CFG)

    assert csv_out["file_id"] == ps_id
    assert csv_captured == [(f"/api/papersets/{ps_id}/csv-view", USER)]


# ---------------------------------------------------------------------------
# 5. browse_papersets is exported in data.TOOLS
# ---------------------------------------------------------------------------


def test_browse_papersets_in_data_tools():
    from tools import data  # noqa: PLC0415

    names = {t.name for t in data.TOOLS}
    assert "browse_papersets" in names