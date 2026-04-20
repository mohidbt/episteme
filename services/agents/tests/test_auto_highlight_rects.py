"""RED tests for Phase 2.1.2 — highlight rect positioning bugfix.

These tests compare the production pypdf-based rect math to pdfplumber
`page.chars` ground truth. They are expected to FAIL until Task 50 swaps
`_rect_for_span` to use pdfplumber's per-glyph coordinates.

Truth source: pdfplumber `page.chars` (per-glyph x0/y0/x1/y1, bottom-origin).
The production pipeline uses pypdf's `visitor_text` (line-level fragments)
and approximates per-char advance as `fsz * 0.5`, which drifts by 10–30pt
on long offsets and can land on the wrong column entirely in multi-column
PDFs.

Fixture page mapping: `tests/fixtures/chemosensory.pdf` is a trimmed
4-page carve of the original source. Fixture pages 1, 2, 3, 4 correspond
to source pages 1, 2, 5, 21 (the plan refers to the source page numbers;
iteration in these tests uses the trimmed 1..4 indices).
"""

import os
from pathlib import Path

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")
os.environ["INHALE_STUB_EMBEDDINGS"] = "1"

import pdfplumber
import pytest
from pypdf import PdfReader

from lib.auto_highlight_tools import (
    _extract_with_positions,
    _find_exact,
    _rect_for_span,
    is_stale_rect,
)


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "chemosensory.pdf"
TARGET = "chemosensory"
# x0 tolerance in PDF points. Real glyph position should be within a few points
# of truth. Production drifts far more than this on the fixture.
X_TOL = 3.0
Y_TOL = 3.0


# ---------- pdfplumber truth helpers -----------------------------------------


def _find_target_in_chars(chars, target: str):
    """Return list of (start_idx, end_idx) into `chars` where target appears
    (case-insensitive). Matches glyph-by-glyph against `char['text']`.
    """
    tl = target.lower()
    tn = len(tl)
    n = len(chars)
    hits = []
    for i in range(n - tn + 1):
        ok = True
        for j in range(tn):
            if (chars[i + j].get("text") or "").lower() != tl[j]:
                ok = False
                break
        if ok:
            hits.append((i, i + tn))
    return hits


def _truth_bboxes(page, target: str):
    """Return list of truth bboxes for `target` on `page`, grouped by line.

    Each entry: {'x0','y0','x1','y1','count'} in bottom-origin PDF coords.
    A line is a run of chars with similar (y0, y1). If a hit spans lines,
    it yields multiple bboxes (one per line).
    """
    chars = page.chars
    hits = _find_target_in_chars(chars, target)
    out = []
    for (s, e) in hits:
        # Group the hit's chars by y-band.
        lines: list[list] = []
        for c in chars[s:e]:
            if lines and abs(lines[-1][-1]["y0"] - c["y0"]) < 1.0:
                lines[-1].append(c)
            else:
                lines.append([c])
        for line in lines:
            out.append(
                {
                    "x0": min(c["x0"] for c in line),
                    "y0": min(c["y0"] for c in line),
                    "x1": max(c["x1"] for c in line),
                    "y1": max(c["y1"] for c in line),
                    "count": len(line),
                }
            )
    return out


def _pair_by_y(prod_rect, truth_bboxes):
    """Pick the truth bbox whose y-center is closest to prod_rect's."""
    if not truth_bboxes:
        return None
    py = (prod_rect["y0"] + prod_rect["y1"]) / 2.0
    return min(truth_bboxes, key=lambda b: abs(((b["y0"] + b["y1"]) / 2.0) - py))


# ---------- shared loading ---------------------------------------------------


@pytest.fixture(scope="module")
def pypdf_reader():
    return PdfReader(str(FIXTURE))


# ---------- tests ------------------------------------------------------------


def test_rect_matches_pdfplumber_truth(pypdf_reader):
    """Production rects must land within ±3pt of pdfplumber truth on x0/y0."""
    drifts = []  # (page, prod_x0, truth_x0, dx, prod_y0, truth_y0, dy)

    with pdfplumber.open(str(FIXTURE)) as pdf:
        # Fixture pages 1..4 correspond to source pages 1, 2, 5, 21.
        for pno in range(1, 5):
            page = pdf.pages[pno - 1]
            truth = _truth_bboxes(page, TARGET)
            text, frags = _extract_with_positions(str(FIXTURE), pno)
            hits = _find_exact(text, TARGET)
            mb = pypdf_reader.pages[pno - 1].mediabox
            page_x_max = float(mb.right)

            for (s, e) in hits:
                rects = _rect_for_span(frags, s, e, pno, page_x_max)
                for r in rects:
                    best = _pair_by_y(r, truth)
                    if best is None:
                        continue
                    dx = r["x0"] - best["x0"]
                    dy = r["y0"] - best["y0"]
                    drifts.append(
                        (pno, r["x0"], best["x0"], dx, r["y0"], best["y0"], dy)
                    )

    over = [d for d in drifts if abs(d[3]) > X_TOL or abs(d[6]) > Y_TOL]
    msg_lines = [
        f"page {p}: prod=({px:.2f},{py:.2f}) truth=({tx:.2f},{ty:.2f}) "
        f"dx={dx:+.2f} dy={dy:+.2f}"
        for (p, px, tx, dx, py, ty, dy) in drifts
    ]
    assert not over, (
        f"{len(over)}/{len(drifts)} rects drift past ±{X_TOL}pt from "
        f"pdfplumber truth:\n" + "\n".join(msg_lines)
    )


def test_rect_within_mediabox(pypdf_reader):
    """Every rect must fit inside the page mediabox.

    Guards against the clamp regressing. x1 must not exceed
    mediabox.right and y1 must not exceed mediabox.top.
    """
    violations = []

    with pdfplumber.open(str(FIXTURE)) as pdf:
        # Fixture pages 1..4 correspond to source pages 1, 2, 5, 21.
        for pno in range(1, 5):
            mb = pypdf_reader.pages[pno - 1].mediabox
            page_x_max = float(mb.right)
            page_y_max = float(mb.top)
            text, frags = _extract_with_positions(str(FIXTURE), pno)
            hits = _find_exact(text, TARGET)
            for (s, e) in hits:
                rects = _rect_for_span(frags, s, e, pno, page_x_max)
                for r in rects:
                    if r["x1"] > page_x_max + 0.01:
                        violations.append(
                            f"page {pno}: x1={r['x1']:.2f} > "
                            f"mediabox.right={page_x_max:.2f}"
                        )
                    if r["y1"] > page_y_max + 0.01:
                        violations.append(
                            f"page {pno}: y1={r['y1']:.2f} > "
                            f"mediabox.top={page_y_max:.2f}"
                        )

    assert not violations, (
        "mediabox violations:\n" + "\n".join(violations)
    )


def test_rect_width_matches_truth(pypdf_reader):
    """Every rect width must match pdfplumber's truth width within ±5pt AND
    satisfy the `char_count * 2pt` floor from the plan.

    The width-parity check is the crisp failure signal for the pypdf
    approximation drift (`fsz × 0.5 × char_count` ignores real glyph
    advance widths). The explicit floor `rect_width >= char_count * 2pt`
    additionally guards the sliver regression from legacy run
    `3a2e170b`, where a small rect could otherwise slip past the parity
    check when the truth width itself is small.
    """
    violations = []

    with pdfplumber.open(str(FIXTURE)) as pdf:
        # Fixture pages 1..4 correspond to source pages 1, 2, 5, 21.
        for pno in range(1, 5):
            page = pdf.pages[pno - 1]
            truth = _truth_bboxes(page, TARGET)
            mb = pypdf_reader.pages[pno - 1].mediabox
            page_x_max = float(mb.right)
            text, frags = _extract_with_positions(str(FIXTURE), pno)
            hits = _find_exact(text, TARGET)
            char_count = len(TARGET)
            floor = char_count * 2.0
            for (s, e) in hits:
                rects = _rect_for_span(frags, s, e, pno, page_x_max)
                for r in rects:
                    w = r["x1"] - r["x0"]
                    if w < floor:
                        violations.append(
                            f"page {pno}: rect width {w:.2f} below sliver floor "
                            f"{floor:.2f}pt (char_count × 2pt) at y0={r['y0']:.1f}"
                        )
                    best = _pair_by_y(r, truth)
                    if best is None:
                        continue
                    tw = best["x1"] - best["x0"]
                    if abs(w - tw) > 5.0:
                        violations.append(
                            f"page {pno}: rect width {w:.2f} vs truth "
                            f"{tw:.2f} (diff {w - tw:+.2f}pt) at y0={r['y0']:.1f}"
                        )

    assert not violations, (
        "rect width violations:\n" + "\n".join(violations)
    )


def test_rect_matches_truth_for_fallback_prone_phrase(pypdf_reader):
    """Regression guard: phrases that land in pypdf↔pdfplumber tokenization
    mismatches (whitespace around superscripts, etc.) must still emit rects
    within ±3pt of pdfplumber truth — not silently drop into the fsz × 0.5
    fallback.

    Fixture page 2 contains 'signalling dynamics' with a superscript '25'
    immediately after. pypdf's visitor_text surfaces a space before '25'
    whereas pdfplumber reads the glyph stream with no space, so the whole
    73-char pypdf fragment previously failed the contiguous glyph-match
    and dropped into the fallback branch (drift ~+16pt on x0).
    """
    page_num = 2
    phrase = "signalling dynamics"

    with pdfplumber.open(str(FIXTURE)) as pdf:
        page = pdf.pages[page_num - 1]
        truth = _truth_bboxes(page, phrase)

    text, frags = _extract_with_positions(str(FIXTURE), page_num)
    hits = _find_exact(text, phrase)
    assert hits, f"fixture invariant: {phrase!r} should exist on page {page_num}"
    assert truth, f"pdfplumber truth should find {phrase!r} on page {page_num}"

    mb = pypdf_reader.pages[page_num - 1].mediabox
    page_x_max = float(mb.right)

    drifts = []
    for (s, e) in hits:
        rects = _rect_for_span(frags, s, e, page_num, page_x_max)
        for r in rects:
            best = _pair_by_y(r, truth)
            if best is None:
                continue
            dx = r["x0"] - best["x0"]
            dy = r["y0"] - best["y0"]
            drifts.append(
                (r["x0"], best["x0"], dx, r["y0"], best["y0"], dy)
            )

    over = [d for d in drifts if abs(d[2]) > X_TOL or abs(d[5]) > Y_TOL]
    msg_lines = [
        f"prod=({px:.2f},{py:.2f}) truth=({tx:.2f},{ty:.2f}) "
        f"dx={dx:+.2f} dy={dy:+.2f}"
        for (px, tx, dx, py, ty, dy) in drifts
    ]
    assert not over, (
        f"{len(over)}/{len(drifts)} rects drift past ±{X_TOL}pt from "
        f"pdfplumber truth:\n" + "\n".join(msg_lines)
    )


def test_multiline_span_yields_per_line_rects(pypdf_reader):
    """A span that crosses fragments on different y-values must emit at least
    two rects with non-overlapping y-bands.

    This is a guard test. The production `_rect_for_span` already groups
    fragments by y (recent mitigation — see `lib/auto_highlight_tools.py`
    lines 356–360), so this test currently PASSES against the pypdf impl.
    The intent is to keep it passing post-Task-50 when `_rect_for_span`
    swaps to pdfplumber — the multiline behaviour must not regress.

    Fixture phrase: 'Articlenature physics' on page 1. In pypdf's
    `extract_text()` output, this 21-char span spans fragment boundaries
    between the top-page 'Article' banner (y≈688) and the rotated
    'nature physics' masthead (y≈21). That makes it a natural
    cross-y span we can assert on without depending on body-text wrap
    (which pypdf tends to fuse with a '\\n' that _find_exact can't
    match through).
    """
    phrase = "Articlenature physics"
    pno = 1
    text, frags = _extract_with_positions(str(FIXTURE), pno)
    hits = _find_exact(text, phrase)
    assert hits, f"fixture invariant: {phrase!r} should exist on page {pno}"

    mb = pypdf_reader.pages[pno - 1].mediabox
    rects = _rect_for_span(frags, hits[0][0], hits[0][1], pno, float(mb.right))

    assert len(rects) >= 2, (
        f"expected >=2 rects for multi-line span, got {len(rects)}: {rects}"
    )
    a, b = rects[0], rects[1]
    # bottom-origin PDF coords: non-overlap means a.y0 > b.y1 or b.y0 > a.y1
    assert a["y0"] > b["y1"] or b["y0"] > a["y1"], (
        f"rects overlap in y: {rects}"
    )


# ---------- Task 52: is_stale_rect predicate -------------------------------


def test_is_stale_rect_sliver():
    """Sliver rect (width 4, height 1) matches the legacy 3a2e170b symptom."""
    assert is_stale_rect({"x0": 10, "y0": 10, "x1": 14, "y1": 11}) is True


def test_is_stale_rect_normal_width():
    """Width >= 5 rescues a rect even if height is tiny."""
    assert is_stale_rect({"x0": 10, "y0": 10, "x1": 16, "y1": 11}) is False


def test_is_stale_rect_normal_height():
    """Height >= 2 rescues a rect even if width is tiny."""
    assert is_stale_rect({"x0": 10, "y0": 10, "x1": 14, "y1": 13}) is False


def test_is_stale_rect_both_large():
    """Typical realistic rect is clearly not stale."""
    assert is_stale_rect({"x0": 100, "y0": 400, "x1": 160, "y1": 412}) is False
