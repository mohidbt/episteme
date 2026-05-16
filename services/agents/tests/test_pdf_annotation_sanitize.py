"""Tests for the agents-side annotation field sanitizer.

Defense-in-depth complement to the JS km-side sanitizer at
`apps/km/src/lib/citations/parser.ts` (`sanitizeRefField`). Springer-Nature
InDesign PDF exports leak the source filename prefix (e.g.
"springernature_nature_8614.indd:") and U+FEFF / zero-width / control chars
into named-destination annotation bodies. We strip these at the source
before returning from `/agents/pdf/annotations`.
"""

from routers.pdf_text import _sanitize_ref_field


def test_strips_indd_filename_prefix():
    assert (
        _sanitize_ref_field("springernature_nature_8614.indd: Shin et al")
        == "Shin et al"
    )


def test_strips_indd_filename_prefix_case_insensitive():
    assert _sanitize_ref_field("Foo.INDD :Body") == "Body"


def test_strips_zero_width_no_break_space():
    # U+FEFF before and inside
    assert _sanitize_ref_field("﻿Shin﻿ Y.") == "Shin Y."


def test_strips_zero_width_joiners_and_soft_hyphen():
    s = "A​B‌C‍D­E"
    assert _sanitize_ref_field(s) == "ABCDE"


def test_strips_control_chars():
    s = "X\x00\x01\x1fY"
    assert _sanitize_ref_field(s) == "XY"


def test_preserves_tab_newline_cr():
    # \t \n \r must NOT be stripped (they are NOT in the invisible-chars set).
    assert _sanitize_ref_field("a\tb\nc\rd") == "a\tb\nc\rd"


def test_none_returns_none():
    assert _sanitize_ref_field(None) is None


def test_empty_returns_none():
    assert _sanitize_ref_field("") is None
    assert _sanitize_ref_field("   ﻿  ") is None


def test_combined_indd_plus_bom():
    s = "﻿some_file.indd:﻿\t1. Shin, Y."
    assert _sanitize_ref_field(s) == "1. Shin, Y."


def test_extract_annotations_sanitizes_reference_fields(monkeypatch):
    """Integration: a /Link annotation whose named destination contains the
    Springer-Nature corruption must surface a sanitized reference."""
    from routers import pdf_text

    class FakeAnnotObj(dict):
        def get_object(self):
            return self

    class FakeAnnotRef:
        def __init__(self, obj):
            self._obj = obj

        def get_object(self):
            return self._obj

    # Build a /Link annotation whose /Dest carries the corrupt rich form
    # captured from production Springer-Nature PDFs.
    dest = (
        "springernature_nature_8614.indd:﻿1.﻿\t"
        "Shin, Y. & Brangwynne, C. Liquid phase condensation in cell physiology"
        " and disease. Science 357, eaaf4382 (2017).:79"
    )
    ann_obj = FakeAnnotObj(
        {
            "/Subtype": "/Link",
            "/Rect": [10.0, 20.0, 30.0, 40.0],
            "/Dest": dest,
        }
    )

    class FakePage(dict):
        pass

    page = FakePage({"/Annots": [FakeAnnotRef(ann_obj)]})

    class FakeReader:
        pages = [page]

    result = pdf_text._extract_annotations(FakeReader())
    assert len(result["references"]) == 1
    ref = result["references"][0]
    assert ref["markerIndex"] == 1
    # rawText must not contain the .indd prefix or U+FEFF.
    assert ".indd" not in ref["rawText"].lower()
    assert "﻿" not in ref["rawText"]
    # Title / authors should not carry residual invisibles either.
    if ref["title"]:
        assert "﻿" not in ref["title"]
        assert ".indd" not in ref["title"].lower()
    if ref["authors"]:
        assert "﻿" not in ref["authors"]
