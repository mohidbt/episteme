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

router = APIRouter(prefix="/agents", tags=["outline"])


class OutlineResponse(BaseModel):
    sections: list[SectionOut]


@router.get("/outline")
async def outline(
    auth: InternalAuthDep,
    conn: ConnDep,
    documentId: Annotated[int, Query()],
) -> OutlineResponse:
    # 1. Check for cached sections
    rows = await conn.fetch(
        """
        SELECT id, document_id, section_index, title, content, page_start, page_end, created_at
        FROM document_sections
        WHERE document_id = $1
        ORDER BY section_index ASC
        """,
        documentId,
    )
    if rows:
        return OutlineResponse(sections=[_row_to_section(r) for r in rows])

    # 2. Get document file_path
    doc = await conn.fetchrow(
        "SELECT file_path FROM documents WHERE id = $1 AND user_id = $2",
        documentId, auth["user_id"],
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # 3. Extract PDF text (first 30 pages) — blocking I/O in thread
    pages = await anyio.to_thread.run_sync(lambda: extract_pages(doc["file_path"]))
    sample = "\n\n".join(
        f"[Page {p['page_number']}]\n{p['text']}"
        for p in pages[:30]
    )

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
            INSERT INTO document_sections (document_id, section_index, title, content, page_start, page_end)
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING id, document_id, section_index, title, content, page_start, page_end, created_at
            """,
            documentId, i, s["title"], s.get("preview", ""), int(s["page"]),
        )
        inserted_rows.append(row)

    return OutlineResponse(sections=[_row_to_section(r) for r in inserted_rows])


def _row_to_section(row) -> SectionOut:
    return SectionOut(
        id=row["id"],
        documentId=row["document_id"],
        sectionIndex=row["section_index"],
        title=row["title"],
        content=row["content"],
        pageStart=row["page_start"],
        pageEnd=row["page_end"],
        createdAt=row["created_at"].isoformat() if row["created_at"] else "",
    )
