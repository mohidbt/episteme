"""
Chandra JSON output (observed via datalab-python-sdk v0.5.0 / Datalab Marker API):

  result.json: dict — top-level document node
    result.json["children"]: list of page-block dicts
      page["block_type"]: "Page"
      page["bbox"]: [x0, y0, x1, y1] — page extents in image-pixel space (origin TOP-LEFT)
      page["children"]: list of block dicts, each block:
        block["block_type"]: str — one of the values below
        block["bbox"]: [x0, y0, x1, y1] — image-pixel coords, origin TOP-LEFT
        block["html"]: str — HTML representation of the block
        block["id"]: str — e.g. "/page/0/SectionHeader/0"
        block["children"]: list — nested child blocks (may be absent or empty)

  Bboxes are stored NORMALIZED to fractions (0..1) of page width/height so the
  frontend can position markers without knowing Chandra's render DPI.

  Known block_type values (Marker/Datalab):
    "SectionHeader", "Text", "Picture", "Figure", "Table",
    "Equation", "Formula", "Caption", "Code", "ListItem",
    "PageHeader", "PageFooter", "Footnote", "TextInlineMath"

Mapping to document_segments.kind:
  "SectionHeader"              → "section_header"
  "Picture" | "Figure"         → "figure"
  "Equation" | "Formula"       → "formula"
  "Table"                      → "table"
  "Text" | "TextInlineMath"    → "paragraph"
  (all others dropped)

Parsing helpers (parse_blocks, run_chandra, insert_segments) live in
services/agents/lib/chandra.py — extracted in 1.4.x T2 so tools/ensure_parsed
can reuse them.
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.chandra import (
    insert_segments,
    parse_blocks as _parse_blocks,  # re-exported under the original underscore name
    run_chandra as _run_chandra,    # so existing patch("routers.chandra_segments._run_chandra") works
)

# Re-export internal helpers for tests that reach in by name.
from lib.chandra import (  # noqa: F401
    _build_payload,
    _normalized_bbox,
    _page_dims,
    _page_index_from_id,
    _strip_html,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["chandra-segments"])


class ChandraSegmentsBody(BaseModel):
    document_id: int
    file_path: str


class ChandraSegmentsResponse(BaseModel):
    success: bool
    segment_count: int
    page_count: int
    skipped: bool = False


@router.post("/chandra-segments", response_model=ChandraSegmentsResponse)
async def chandra_segments(
    body: ChandraSegmentsBody,
    auth: InternalAuthDep,
    conn: ConnDep,
) -> ChandraSegmentsResponse:
    ocr_key: str = auth.get("ocr_key", "") or ""
    if not ocr_key:
        return ChandraSegmentsResponse(
            success=True, segment_count=0, page_count=0, skipped=True
        )

    document_id = body.document_id

    result = await _run_chandra(body.file_path, ocr_key)

    if not result.success or result.json is None:
        logger.warning(
            "Chandra convert failed for document %d: %s", document_id, result.error
        )
        return ChandraSegmentsResponse(
            success=True, segment_count=0, page_count=result.page_count or 0
        )

    rows = _parse_blocks(result.json)

    await insert_segments(conn, document_id, rows)

    return ChandraSegmentsResponse(
        success=True,
        segment_count=len(rows),
        page_count=result.page_count or 0,
    )
