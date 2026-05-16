"""Tests for bare-ID /Dest annotations (follow-up #40).

Some PDFs (observed: Family Medicine `psm-paper-1.pdf`) author citation
links with hex-encoded bare-ID destinations:

    /Link annotation /Dest = "5"   ->  reference 5
    /Link annotation /Dest = "a"   ->  reference 10 (hex 0xa)
    /Link annotation /Dest = "10"  ->  reference 16 (hex 0x10)

The destination string IS the citation index expressed in hex. The named-
destinations table only encodes page+anchor coordinates, not a label, so
the string itself is the only marker-index signal we have.

The previous `_marker_from_dest` regex required a trailing `.` after the
digits and so dropped 100% of these annotations, producing 0 markers and
losing all clickable rects on these PDFs.
"""

from pypdf import PdfReader

from routers.pdf_text import _extract_annotations, _marker_from_dest


def test_bare_hex_digit_dest_yields_marker_index():
    """Pure-digit bare ID parses as a hex value."""
    idx, raw, parsed = _marker_from_dest("5")
    assert idx == 5
    assert raw == "5"


def test_bare_hex_two_digit_dest_yields_marker_index():
    idx, _raw, _parsed = _marker_from_dest("10")
    assert idx == 16  # 0x10


def test_bare_hex_letter_dest_yields_marker_index():
    idx, _raw, _parsed = _marker_from_dest("a")
    assert idx == 10  # 0xa


def test_bare_hex_letter_digit_combo_dest_yields_marker_index():
    idx, _raw, _parsed = _marker_from_dest("1a")
    assert idx == 26  # 0x1a


def test_long_alpha_dest_is_not_treated_as_hex():
    """Strings like 'intro' or 'abstract' must NOT decode to hex —
    they happen to contain hex chars but are anchor labels, not refs."""
    idx, _raw, _parsed = _marker_from_dest("abstract")
    assert idx is None


def test_rich_springer_dest_still_wins_over_bare_hex():
    """The Springer/Nature rich-ref dialect must keep priority — its
    leading filename token contains hex chars but the rich regex must
    parse the colon-anchored numeric index instead."""
    dest = (
        "springernature_nature_8614.indd:﻿1.﻿\tShin, Y. & Brangwynne,"
        " C. Liquid phase condensation. Science 357, eaaf4382 (2017).:79"
    )
    idx, _raw, parsed = _marker_from_dest(dest)
    assert idx == 1
    assert parsed is not None


def test_simple_anchor_dest_still_wins_over_bare_hex():
    """`cite.foo3.` must still resolve to 3 via the simple-anchor path,
    not via accidental hex decode of the trailing `3`."""
    idx, _raw, _parsed = _marker_from_dest("cite.foo3.")
    assert idx == 3


def test_psm_paper_1_extracts_all_hex_bare_id_markers():
    """End-to-end: the real Family Medicine PDF (`psm-paper-1.pdf`)
    contains 36 bare-ID /Link annotations encoded as hex 5..28.
    All must be extracted with decimal indices 5..40."""
    reader = PdfReader(
        "/Users/mohidbutt/Documents/Claudius/episteme/apps/km/public/seed/"
        "psm-paper-1.pdf"
    )
    result = _extract_annotations(reader)
    indices = sorted({m["markerIndex"] for m in result["markers"]})
    assert indices == list(range(5, 41))
    # 36 unique references should be recorded.
    assert len(result["references"]) == 36
