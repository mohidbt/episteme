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


def _extract_page_text(page) -> str:
    """Extract text, with a column-aware path for two-column layouts.

    Default pdfplumber `extract_text()` is column-agnostic: on a 2-column page
    it concatenates left-and-right column text into the same logical line,
    which destroys bibliographies whose entries flow per-column (Family
    Medicine journal observed in prod — see psm-paper-1.pdf seed).

    Heuristic: if the page has a clear vertical gutter near its midline
    (few chars within ±15pt of x = width/2) and left/right halves are both
    populated, extract each half independently and concatenate left→right.
    Otherwise fall back to the default extractor.
    """
    chars = page.chars
    if not chars:
        return page.extract_text() or ""
    mid = page.width / 2
    gutter_lo = mid - 15
    gutter_hi = mid + 15
    total = len(chars)
    in_gutter = sum(1 for c in chars if gutter_lo < c["x0"] < gutter_hi)
    left = sum(1 for c in chars if c["x0"] < gutter_lo)
    right = sum(1 for c in chars if c["x0"] > gutter_hi)
    gutter_ratio = in_gutter / total if total else 1.0
    is_two_col = (
        gutter_ratio < 0.05
        and left > total * 0.25
        and right > total * 0.25
    )
    if not is_two_col:
        return page.extract_text() or ""
    left_text = (
        page.crop((0, 0, mid, page.height)).extract_text() or ""
    )
    right_text = (
        page.crop((mid, 0, page.width, page.height)).extract_text() or ""
    )
    if left_text and right_text:
        return left_text + "\n" + right_text
    return left_text or right_text or (page.extract_text() or "")


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
                    pages.append({"pageNumber": body.page, "text": _extract_page_text(p)})
                else:
                    for idx, p in enumerate(pdf.pages, start=1):
                        pages.append({"pageNumber": idx, "text": _extract_page_text(p)})
                return {"pages": pages}
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="file not found") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# Defense-in-depth sanitizer for Springer-Nature InDesign export corruption.
# Mirrors `sanitizeRefField` in apps/km/src/lib/citations/parser.ts so callers
# downstream see the same scrubbed strings whether the JS or Python path wins.
# - U+FEFF zero-width no-break space (BOM)
# - U+200B–U+200D zero-width space / joiners
# - U+00AD soft hyphen
# - U+0000–U+0008, U+000B, U+000C, U+000E–U+001F control chars
#   (TAB \t U+0009, LF \n U+000A, CR \r U+000D intentionally preserved)
_INVISIBLE_CHARS_RE = re.compile(
    "[﻿​-‍­\x00-\x08\x0b\x0c\x0e-\x1f]"
)
# InDesign source filename leak: "springernature_nature_8614.indd:" at the
# start of a field. Case-insensitive. Pattern scope: any leading token
# ending in `.indd:` — acceptable since `.indd` is an InDesign extension and
# not realistic content in academic citation strings.
_INDD_FILENAME_PREFIX_RE = re.compile(r"^\S+\.indd\s*:\s*", re.IGNORECASE)


def _sanitize_ref_field(value: str | None) -> str | None:
    """Strip InDesign filename prefix and invisible/control chars.

    Returns None for null/empty-after-cleaning so callers can flow nullable
    reference fields through unchanged. Non-string inputs return None.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    cleaned = _INVISIBLE_CHARS_RE.sub("", value)
    cleaned = _INDD_FILENAME_PREFIX_RE.sub("", cleaned)
    cleaned = cleaned.strip()
    return cleaned if cleaned else None


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
                # Sanitize the rawText BEFORE author/title/year heuristics so
                # the InDesign filename prefix and U+FEFF noise don't pollute
                # downstream splits. Defense-in-depth mirror of the JS
                # `sanitizeRefField` in apps/km/src/lib/citations/parser.ts.
                cleaned_raw_text = _sanitize_ref_field(raw_text)
                authors, title, year = _extract_authors_year(cleaned_raw_text or "")
                refs[marker_index] = {
                    "markerIndex": marker_index,
                    "rawText": cleaned_raw_text
                    or _sanitize_ref_field(raw)
                    or f"{marker_index}.",
                    "title": _sanitize_ref_field(title),
                    "authors": _sanitize_ref_field(authors),
                    "year": _sanitize_ref_field(year),
                    # doi/url not extracted from annotations yet. If wired
                    # later, pass through `_sanitize_ref_field` as well.
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
