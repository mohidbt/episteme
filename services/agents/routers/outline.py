import json
from typing import Annotated
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel
import anyio

from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.openrouter_client import call_model
from lib.pdf_text import extract_pages
from lib.models import SectionOut
from lib.ownership import ResourceNotOwned, require_paper_owner
from lib.storage import (
    SourcePdfMissing,
    download_to_tempfile,
    object_exists,
    paperSourceKey,
)

router = APIRouter(prefix="/agents", tags=["outline"])


class OutlineResponse(BaseModel):
    sections: list[SectionOut]


@router.get("/outline")
async def outline(
    auth: InternalAuthDep,
    conn: ConnDep,
    paperId: Annotated[str, Query()],
) -> OutlineResponse:
    # Verify ownership before reading the shared document_sections cache.
    try:
        paper = await require_paper_owner(
            conn, paper_id=paperId, user_id=auth["user_id"]
        )
    except ResourceNotOwned:
        raise HTTPException(status_code=404, detail="Paper not found") from None

    # 1. Check for cached sections
    rows = await conn.fetch(
        """
        SELECT id, paper_id, section_index, title, content, page_start, page_end, created_at
        FROM document_sections
        WHERE paper_id = $1
        ORDER BY section_index ASC
        """,
        paperId,
    )
    if rows:
        return OutlineResponse(sections=[_row_to_section(r) for r in rows])

    # GSD-135: Source PDF may be missing in R2 (ingest dropped or lifecycle
    # reaped). Pre-check so callers get a structured 404 instead of a 500.
    storage_key = paper["storage_url"] or paperSourceKey(paperId)
    if not await object_exists(storage_key):
        raise HTTPException(status_code=404, detail="source_pdf_missing")

    # 3. Download source.pdf from R2 to a local tempfile, then extract text.
    # extract_pages reads a LOCAL path; in serverless the R2 key is NOT a file
    # on disk, so it must be downloaded first (mirrors lib/chandra.py).
    try:
        async with download_to_tempfile(storage_key) as local_path:
            pages = await anyio.to_thread.run_sync(
                lambda: extract_pages(local_path)
            )
    except SourcePdfMissing:
        raise HTTPException(status_code=404, detail="source_pdf_missing")
    sample = "\n\n".join(
        f"[Page {p['page_number']}]\n{p['text']}"
        for p in pages[:30]
    )[:120_000]

    # 4. Call LLM
    system = (
        'You are a research paper analyzer. Return a JSON array of sections. '
        'Schema: [{"title": string, "page": number, "preview": string}]. '
        'Use real page numbers from the [Page N] markers. Return ONLY the JSON array, no markdown.'
    )
    raw = await call_model(auth["llm_key"], system, sample)

    # 5. Parse and validate
    json_text = raw.strip()
    if json_text.startswith("```"):
        json_text = json_text.split("\n", 1)[1] if "\n" in json_text else json_text[3:]
    if json_text.endswith("```"):
        json_text = json_text[:-3]
    json_text = json_text.strip()

    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON")

    if not isinstance(parsed, list):
        raise HTTPException(status_code=502, detail="Model returned non-array JSON")

    valid = [
        s for s in parsed
        if isinstance(s.get("title"), str) and isinstance(s.get("page"), (int, float))
    ]
    if not valid:
        raise HTTPException(status_code=502, detail="Model returned no valid sections")

    # 6. Insert into DB
    inserted_rows = []
    for i, s in enumerate(valid):
        row = await conn.fetchrow(
            """
            INSERT INTO document_sections (paper_id, section_index, title, content, page_start, page_end)
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING id, paper_id, section_index, title, content, page_start, page_end, created_at
            """,
            paperId, i, s["title"], s.get("preview", ""), int(s["page"]),
        )
        inserted_rows.append(row)

    return OutlineResponse(sections=[_row_to_section(r) for r in inserted_rows])


def _row_to_section(row) -> SectionOut:
    return SectionOut(
        id=row["id"],
        paperId=str(row["paper_id"]),
        sectionIndex=row["section_index"],
        title=row["title"],
        content=row["content"],
        pageStart=row["page_start"],
        pageEnd=row["page_end"],
        createdAt=row["created_at"].isoformat() if row["created_at"] else "",
    )
