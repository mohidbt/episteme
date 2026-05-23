"""LangChain tools: browse_papersets + csv_read + csv_write_cell.

These tools are the data-extract skill's surface — they call back into
apps/km via the same HMAC-signed channel that ``tools/notes.py`` uses (see
``lib/km_http.py``). All write guards (grounding non-empty, idempotent retry,
row/col bounds) live server-side; this client surfaces KM-side errors as
clear strings/dicts so the agent loop stays alive (per ``_safe_response``).

The authenticated user_id is injected at runtime via ``RunnableConfig`` —
never accepted from the LLM. See ``tools/_auth.py`` and §1.3b-E2E-3.
"""
from __future__ import annotations

import json
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib import km_http
from lib.km_http import km_get, km_patch
from tools._auth import user_id_from_config


class Grounding(TypedDict):
    paper_id: str
    block_ids: list[str]


class CsvView(TypedDict):
    file_id: str
    columns: list[dict]
    row_refs: list[dict]
    cells: dict


def _is_error(resp: object) -> bool:
    return isinstance(resp, dict) and bool(resp.get("error"))


@tool
async def browse_papersets(*, config: RunnableConfig) -> object:
    """List all papersets / spreadsheets / extraction tables the user owns.

    A "paperset" (also called a spreadsheet, CSV, or extraction table) is a
    structured table where each ROW is a paper and each COLUMN is a piece of
    information to extract from that paper.

    USE THIS — not find_papers — whenever the user asks about:
      - "papersets", "paper sets"
      - "spreadsheets", "csvs", "tables", "extraction tables"
      - "show me my data", "what tables do I have", "list my sheets"

    Returns the full set from the KM API; no query required. Each paperset in
    the response includes:
    - id: UUID for use with csv_read and csv_write_cell
    - filename: Display name
    - rowRefs: Array of {paper_id} — len = row count
    - columns: Array of {name, description} — column schema

    After browsing, use csv_read to inspect a specific paperset's cells and
    csv_write_cell to write/enrich a cell with extracted data.
    """
    user_id = user_id_from_config(config)
    return await km_get("/api/papersets", user_id=user_id)


@tool
async def csv_read(file_id: str, *, config: RunnableConfig) -> object:
    """Read the contents of a paperset / spreadsheet / extraction table.

    USE THIS when the user asks to "read", "show", "open", "view", or
    "inspect" a specific paperset/spreadsheet/CSV/table. Returns the full
    grid of cells plus column schema and row references.

    Returns ``{file_id, columns, row_refs, cells}`` where ``cells`` is a dict
    keyed by ``"<row>:<col>"`` mapping to the current cell value (only
    non-empty cells are present).

    Also use this BEFORE ``csv_write_cell`` to confirm a cell is empty (or to
    confirm the value you intend to write matches an existing one — the
    server accepts idempotent retries with the same value).

    Args:
        file_id: Paperset UUID (get it from browse_papersets).
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/papersets/{file_id}/csv-view", user_id=user_id)


@tool
async def csv_write_cell(
    file_id: str,
    row: int,
    col: str,
    value: str,
    grounding: Grounding,
    *,
    config: RunnableConfig,
) -> object:
    """Enrich ONE cell of a paperset / spreadsheet / extraction table.

    USE THIS to "fill", "enrich", "extract into", or "write" a single cell
    of a paperset/spreadsheet/CSV. One call = one cell. The KM enrichment
    route runs the column prompt against the row's paper and stores the result.

    PRECONDITION: For any cell where ``grounding.paper_id`` is set, you MUST call
    ``read_paper(paper_id=<that id>, scope=...)`` earlier in this thread before
    calling csv_write_cell. The runtime enforces this — an error ToolMessage is
    returned if no prior read is observed.

    ``value`` and ``grounding`` remain in the schema for backward
    compatibility with older prompts, but user-facing calls ignore them. The
    model must not decide and write arbitrary cell values.

    On success returns the literal string ``"ok"``. On KM-side 4xx/5xx
    returns a string like ``"error: unknown_col"`` so the agent
    can adapt — never raises into the LangGraph stream.

    Args:
        file_id: Paperset UUID.
        row: Zero-based row index into ``row_refs``.
        col: Column name (must match one of the paperset's columns).
        value: Ignored unless the private extraction route is performing the
            final internal write.
        grounding: Ignored unless the private extraction route is performing
            the final internal write.
    """
    user_id = user_id_from_config(config)
    configurable = config.get("configurable", {}) if isinstance(config, dict) else {}

    if not configurable.get("allow_direct_csv_write"):
        body = {"cells": [{"row_idx": row, "col_name": col}]}
        path = f"/api/papersets/{file_id}/enrich"
        body_bytes = json.dumps(body).encode()
        headers = km_http._auth_headers("POST", path, body_bytes, user_id)
        try:
            resp = await km_http._client.post(
                km_http._km_base_url() + path,
                content=body_bytes,
                headers=headers,
            )
        except Exception as e:  # noqa: BLE001
            return f"error: {type(e).__name__}: {e}"
        if not resp.is_success:
            err = km_http._safe_response(resp)
            body_err = err.get("body") if isinstance(err, dict) else err
            if isinstance(body_err, dict):
                code = str(body_err.get("error") or body_err)
            else:
                code = str(body_err)
            status = err.get("status") if isinstance(err, dict) else resp.status_code
            return f"error: {code} (status={status})"
        # Drain the SSE body so the enrichment run completes before the tool
        # returns. The client UI receives updates through the paperset stream.
        await resp.aread()
        return "ok"

    body = {"row": row, "col": col, "value": value, "grounding": grounding}
    resp = await km_patch(f"/api/papersets/{file_id}/cells", body, user_id=user_id)
    if _is_error(resp):
        assert isinstance(resp, dict)
        body_err = resp.get("body")
        code: str
        if isinstance(body_err, dict):
            code = str(body_err.get("error") or body_err)
        else:
            code = str(body_err)
        return f"error: {code} (status={resp.get('status')})"
    return "ok"


TOOLS = [browse_papersets, csv_read, csv_write_cell]
