"""Regression test for follow-up #39 — pdfplumber word-space loss.

pdfplumber's default `extract_text()` uses `x_tolerance=3`, which collapses
inter-word whitespace on PDFs whose actual space glyph advance is <3pt
(observed at ~2pt on Family Medicine `psm-paper-1.pdf` and arXiv
`2005.11401.pdf`). The fix in `_extract_page_text` lowers `x_tolerance`
so genuine word boundaries survive without splitting real tokens.
"""
from __future__ import annotations

import re
from pathlib import Path

import pdfplumber
import pytest

from routers.pdf_text import _extract_page_text

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_DIR = REPO_ROOT / "apps" / "km" / "public" / "seed"
MANGLING_PDF = SEED_DIR / "psm-paper-1.pdf"
ARXIV_PDF = SEED_DIR / "2005.11401.pdf"

# Match an unrealistically long run of lowercase letters with no whitespace —
# any 24+-letter run is overwhelmingly a glued-token artifact, not a real word.
# (Longest English words top out near 20-23 chars; we leave a safety margin.)
GLUED_TOKEN_RE = re.compile(r"[a-z]{24,}")


def _glued_tokens(text: str) -> list[str]:
    return GLUED_TOKEN_RE.findall(text)


@pytest.mark.skipif(not MANGLING_PDF.exists(), reason="seed pdf missing")
def test_psm_paper_no_glued_tokens():
    """Family Medicine 2-col PDF must not produce glued-word artifacts."""
    with pdfplumber.open(str(MANGLING_PDF)) as pdf:
        # Pages 2 and 3 are the dense 2-column body where the bug shows up.
        for idx in (1, 2):
            text = _extract_page_text(pdf.pages[idx])
            glued = _glued_tokens(text)
            assert not glued, f"page {idx + 1} produced glued tokens: {glued[:3]}"
            # Sanity: real words present with whitespace around them.
            assert " the " in text or "\nthe " in text


@pytest.mark.skipif(not ARXIV_PDF.exists(), reason="seed pdf missing")
def test_arxiv_rag_paper_no_glued_tokens():
    """arXiv 2005.11401 (RAG paper) — body pages must not glue words."""
    with pdfplumber.open(str(ARXIV_PDF)) as pdf:
        text = _extract_page_text(pdf.pages[2])
    glued = _glued_tokens(text)
    assert not glued, f"glued tokens present: {glued[:3]}"


@pytest.mark.skipif(not MANGLING_PDF.exists(), reason="seed pdf missing")
def test_known_phrase_present_with_spaces():
    """A specific phrase from psm-paper-1 must appear with internal spaces."""
    with pdfplumber.open(str(MANGLING_PDF)) as pdf:
        text = _extract_page_text(pdf.pages[1])
    # Normalize newlines into spaces for cross-column phrase matching.
    flat = re.sub(r"\s+", " ", text)
    # Phrase from the page body. Before fix: glued as "andexposuresassociatedwith".
    assert "exposures associated with" in flat
