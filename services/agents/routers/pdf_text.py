from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pdfplumber
from pypdf import PdfReader

from deps.auth import InternalAuthDep

router = APIRouter(prefix="/agents/pdf", tags=["pdf-text"])


class PdfTextBody(BaseModel):
    file_path: str
    page: int | None = None


class PdfAnnotationsBody(BaseModel):
    file_path: str


@router.post("/text")
async def pdf_text(body: PdfTextBody, auth: InternalAuthDep):
    _ = auth
    try:
        with pdfplumber.open(body.file_path) as pdf:
            pages = []
            if body.page is not None:
                if body.page < 1 or body.page > len(pdf.pages):
                    raise HTTPException(status_code=404, detail="page not found")
                p = pdf.pages[body.page - 1]
                pages.append({"pageNumber": body.page, "text": p.extract_text() or ""})
            else:
                for idx, p in enumerate(pdf.pages, start=1):
                    pages.append({"pageNumber": idx, "text": p.extract_text() or ""})
            return {"pages": pages}
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _marker_from_dest(dest: object) -> tuple[int | None, str | None]:
    if not isinstance(dest, str):
        return None, None
    m = re.search(r"(\d+)\.", dest)
    if not m:
        return None, dest
    return int(m.group(1)), dest


@router.post("/annotations")
async def pdf_annotations(body: PdfAnnotationsBody, auth: InternalAuthDep):
    _ = auth
    try:
        reader = PdfReader(body.file_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    refs: dict[int, dict] = {}
    markers = []
    for page_idx, page in enumerate(reader.pages, start=1):
        annots = page.get("/Annots") or []
        for ann_ref in annots:
            ann = ann_ref.get_object()
            if ann.get("/Subtype") != "/Link":
                continue
            rect = ann.get("/Rect")
            if not rect or len(rect) != 4:
                continue
            dest = ann.get("/Dest")
            marker_index, raw = _marker_from_dest(dest)
            if marker_index is None:
                continue
            refs.setdefault(
                marker_index,
                {"markerIndex": marker_index, "rawText": raw or f"{marker_index}.", "title": None, "authors": None, "year": None, "doi": None, "url": None},
            )
            markers.append(
                {
                    "markerIndex": marker_index,
                    "pageNumber": page_idx,
                    "x0": float(rect[0]),
                    "y0": float(rect[1]),
                    "x1": float(rect[2]),
                    "y1": float(rect[3]),
                }
            )
    return {"references": list(refs.values()), "markers": markers}
