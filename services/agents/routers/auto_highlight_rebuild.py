"""Rebuild glyph rects for highlights in a legacy run.

Task 52 (Phase 2.1.2). For each highlight row tagged with the given
`layer_id`, re-run `_extract_with_positions` + `_rect_for_span` using the
current pdfplumber-backed math and UPDATE the `rects` column in place.
Rows whose stored `text_content` cannot be relocated on the page are left
untouched and counted as skipped.
"""

import json
import logging

import anyio
from fastapi import APIRouter, HTTPException

from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.auto_highlight_tools import (
    _extract_with_positions,
    _find_exact,
    _rect_for_span,
)
from pypdf import PdfReader

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["auto-highlight-rebuild"])


@router.post("/auto-highlight/runs/{run_id}/rebuild")
async def rebuild_run(run_id: str, auth: InternalAuthDep, conn: ConnDep) -> dict:
    user_id = auth["user_id"]
    document_id = auth["document_id"]
    if not document_id:
        raise HTTPException(status_code=400, detail="missing document_id")

    run = await conn.fetchrow(
        "SELECT r.id, d.file_path FROM ai_highlight_runs r "
        "JOIN documents d ON d.id = r.document_id "
        "WHERE r.id = $1::uuid AND r.user_id = $2 AND r.document_id = $3",
        run_id,
        user_id,
        document_id,
    )
    if not run:
        raise HTTPException(status_code=404, detail="Not found")
    pdf_path = run["file_path"]

    rows = await conn.fetch(
        "SELECT id, page_number, text_content, start_offset "
        "FROM user_highlights WHERE layer_id = $1::uuid AND user_id = $2",
        run_id,
        user_id,
    )

    # Group rows by page so we only run extraction once per page.
    by_page: dict[int, list] = {}
    for r in rows:
        by_page.setdefault(r["page_number"], []).append(r)

    updated = 0
    skipped = 0
    reader = await anyio.to_thread.run_sync(lambda: PdfReader(pdf_path))

    for page_number, page_rows in by_page.items():
        try:
            text, fragments = await anyio.to_thread.run_sync(
                lambda: _extract_with_positions(pdf_path, page_number)
            )
        except Exception:
            logger.exception("extraction failed for page %d", page_number)
            skipped += len(page_rows)
            continue
        if text is None:
            skipped += len(page_rows)
            continue
        if page_number < 1 or page_number > len(reader.pages):
            skipped += len(page_rows)
            continue
        page_x_max = float(reader.pages[page_number - 1].mediabox.right)

        for row in page_rows:
            phrase = row["text_content"]
            hits = _find_exact(text, phrase)
            if not hits:
                skipped += 1
                continue
            # Prefer the hit nearest the originally stored start_offset — the
            # phrase may appear multiple times on a page.
            target_start = int(row["start_offset"])
            s, e = min(hits, key=lambda h: abs(h[0] - target_start))
            rects = _rect_for_span(fragments, s, e, page_number, page_x_max)
            if not rects:
                skipped += 1
                continue
            await conn.execute(
                "UPDATE user_highlights SET rects = $1::jsonb, start_offset = $2, "
                "end_offset = $3 WHERE id = $4",
                json.dumps(rects),
                s,
                e,
                row["id"],
            )
            updated += 1

    return {"updated": updated, "skipped": skipped, "total": len(rows)}
