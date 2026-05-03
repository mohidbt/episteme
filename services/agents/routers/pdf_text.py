from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pdfplumber
from pypdf import PdfReader

from deps.auth import InternalAuthDep
from lib.storage import download_to_tempfile

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
        async with download_to_tempfile(body.file_path) as local_path:
            with pdfplumber.open(local_path) as pdf:
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


_REF_FIELD_RE = re.compile(
    # Springer/Nature named-destinations look like:
    #   "<filename>.indd:﻿<N>.﻿\t<authors>. <title>...:<page>"
    # The leading filename often contains its own digits ("3158.indd") which
    # must NOT be treated as the citation index. We anchor on a colon and
    # skip whitespace / BOM / tabs before the first <digits>. dot.
    r":[\s﻿\t]*?(?P<idx>\d{1,3})\.[\s﻿\t]+(?P<body>[^:]*)(?::(?P<page>\d+))?\s*$"
)


def _marker_from_dest(dest: object) -> tuple[int | None, str | None, dict | None]:
    """Return (markerIndex, rawText, parsed) for a /Link annotation destination.

    Two destination dialects observed:
      1. Plain anchor strings: "cite.foo3.", "ref-12.", "bib7." — the ONLY
         "<digits>." token is the citation index.
      2. Springer/Nature embedded refs:
         "filename.indd:1.<bom><tab>Shin, Y. & ... J Cell. 2017.:79"
         where the filename has its own ".<digits>." we must skip.
    """
    if not isinstance(dest, str):
        return None, None, None

    rich = _REF_FIELD_RE.search(dest)
    if rich:
        idx = int(rich.group("idx"))
        body = (rich.group("body") or "").strip().strip("﻿").strip()
        return idx, dest, {"rawText": body or dest}

    # Fallback: simple "<word><digits>." anchor (e.g. "cite.foo3."). Take the
    # LAST digits-dot token so a leading filename like "3158.indd" doesn't win.
    matches = list(re.finditer(r"(?<![\d.])(\d{1,3})\.", dest))
    if not matches:
        return None, dest, None
    idx = int(matches[-1].group(1))
    return idx, dest, None


@router.post("/annotations")
async def pdf_annotations(body: PdfAnnotationsBody, auth: InternalAuthDep):
    _ = auth
    try:
        async with download_to_tempfile(body.file_path) as local_path:
            reader = PdfReader(local_path)
            return _extract_annotations(reader)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _resolve_dest(ann: dict) -> object:
    """Get the destination of a /Link annotation.

    PDFs use either /Dest directly or /A (action) with /D pointing at a named
    destination. The previous implementation only read /Dest, so PDFs with
    actions silently produced 0 markers.
    """
    dest = ann.get("/Dest")
    if dest is not None:
        return dest
    action = ann.get("/A")
    if action is None:
        return None
    try:
        action_obj = action.get_object() if hasattr(action, "get_object") else action
    except Exception:  # noqa: BLE001
        return None
    if not action_obj:
        return None
    return action_obj.get("/D")


def _extract_authors_year(body: str) -> tuple[str | None, str | None, str | None]:
    """Best-effort split of a Springer/Nature named-dest body into
    (authors, title, year).

    Heuristic: authors run up to the first ". " followed by an uppercase
    letter that is NOT an initial; year is the first 4-digit 19xx/20xx token.
    Title is what's between authors and year/journal. Failure returns Nones.
    """
    if not body:
        return None, None, None
    year_match = re.search(r"\b(19\d{2}|20\d{2})\b", body)
    year = year_match.group(1) if year_match else None
    # Authors end at the first occurrence of ". " followed by capital letter
    # that is not part of an initial (i.e. not "X. Y."). Conservative.
    parts = re.split(r"\.\s+(?=[A-Z][a-z])", body, maxsplit=1)
    if len(parts) == 2:
        authors = parts[0].strip().rstrip(",")
        rest = parts[1]
        title = rest.split(".")[0].strip() if "." in rest else rest.strip()
    else:
        authors = None
        title = None
    return authors, title, year


def _extract_annotations(reader: PdfReader) -> dict:
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
            dest = _resolve_dest(ann)
            marker_index, raw, parsed = _marker_from_dest(dest)
            if marker_index is None:
                continue
            if marker_index in refs:
                pass
            else:
                raw_text = (parsed or {}).get("rawText") if parsed else None
                authors, title, year = _extract_authors_year(raw_text or "")
                refs[marker_index] = {
                    "markerIndex": marker_index,
                    "rawText": raw_text or raw or f"{marker_index}.",
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "doi": None,
                    "url": None,
                }
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
