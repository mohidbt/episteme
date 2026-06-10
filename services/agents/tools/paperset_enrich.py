"""LangChain tool: paperset_enrich — batch cell-fill for a paperset.

Wraps ``POST /api/papersets/{id}/enrich`` (SSE stream). Computes the
``cells[]`` payload from the agent's row/column/mode args by first
reading the paperset's ``/csv-view`` to learn its shape and current
fill state.

Cost-heavy — fans out N LLM calls server-side. Carries
``require_approval`` metadata so the agent's HumanInTheLoopMiddleware
gates it.

The authenticated user_id is injected at runtime via ``RunnableConfig``.
"""
from __future__ import annotations

import json
from typing import Literal

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib import km_http
from lib.km_http import km_get
from tools._auth import user_id_from_config


@tool
async def paperset_enrich(
    paperset_id: str,
    rows: list[int] | None = None,
    columns: list[str] | None = None,
    mode: Literal["blank-only", "all"] = "blank-only",
    *,
    config: RunnableConfig,
) -> object:
    """Enrich (fill via LLM) a batch of cells in a paperset / spreadsheet.

    REQUIRES HUMAN APPROVAL — this fans out one LLM call per cell. For
    a 50-row paperset with 5 blank columns, that's 250 calls.

    Args:
        paperset_id: Paperset UUID.
        rows: Optional zero-based row indices to scope to. Omit for all rows.
        columns: Optional column names to scope to. Omit for all columns.
        mode: ``"blank-only"`` (default) skips cells that already have a
            value. ``"all"`` re-fills every cell in scope, overwriting.
    """
    user_id = user_id_from_config(config)

    view = await km_get(f"/api/papersets/{paperset_id}/csv-view", user_id=user_id)
    if isinstance(view, dict) and view.get("error"):
        return view
    if not isinstance(view, dict):
        return {"error": True, "message": "unexpected csv-view payload"}

    col_specs = view.get("columns") or []
    row_refs = view.get("row_refs") or []
    filled = view.get("cells") or {}

    all_col_names = [c.get("name") for c in col_specs if isinstance(c, dict)]
    all_row_idxs = list(range(len(row_refs)))

    target_rows = rows if rows is not None else all_row_idxs
    target_cols = columns if columns is not None else all_col_names

    # Validate column names — KM would 400 on unknown_col but surfacing it
    # here gives the agent a clearer signal.
    unknown = [c for c in target_cols if c not in all_col_names]
    if unknown:
        return {
            "error": True,
            "status": 400,
            "message": f"unknown columns: {unknown}",
        }

    cells: list[dict] = []
    for r in target_rows:
        if r < 0 or r >= len(row_refs):
            return {
                "error": True,
                "status": 400,
                "message": f"row out of range: {r}",
            }
        for c in target_cols:
            if mode == "blank-only" and f"{r}:{c}" in filled:
                continue
            cells.append({"row_idx": r, "col_name": c})

    if not cells:
        return {"ok": True, "cells_requested": 0, "note": "nothing to enrich"}

    body = {"cells": cells}
    path = f"/api/papersets/{paperset_id}/enrich"
    body_bytes = json.dumps(body).encode()
    headers = km_http._auth_headers("POST", path, body_bytes, user_id)
    try:
        resp = await km_http._client.post(
            km_http._km_base_url() + path,
            content=body_bytes,
            headers=headers,
        )
    except Exception as e:  # noqa: BLE001
        return {"error": True, "status": None, "body": f"{type(e).__name__}: {e}"}

    if not resp.is_success:
        return km_http._safe_response(resp)

    # Drain SSE so the server-side fanout completes before the tool returns.
    # The KM UI receives per-cell updates via its own paperset stream.
    await resp.aread()
    return {"ok": True, "cells_requested": len(cells)}


paperset_enrich.metadata = {"require_approval": True}  # type: ignore[attr-defined]

TOOLS = [paperset_enrich]
