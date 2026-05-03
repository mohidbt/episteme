"""Regenerate chemosensory-truth.json from the fixture PDF.

Usage: `python e2e/fixtures/generate-truth.py`
Rerun when the fixture PDF changes or pdfplumber is upgraded.
"""

import json
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
PDF = HERE.parent.parent.parent.parent / "services" / "agents" / "tests" / "fixtures" / "chemosensory.pdf"
OUT = HERE / "chemosensory-truth.json"
SOURCE_PAGE_MAP = {1: 1, 2: 2, 3: 5, 4: 21}  # fixture page → original source page
SENTENCE_PHRASE = "near-critical cooperativity"


def bboxes_for(page, phrase: str) -> list[dict]:
    """Per-line bboxes for every occurrence of `phrase` on `page` (case-insensitive)."""
    chars = page.chars
    tl = phrase.lower()
    out = []
    for i in range(len(chars) - len(tl) + 1):
        if all((chars[i + j].get("text") or "").lower() == tl[j] for j in range(len(tl))):
            hit = chars[i:i + len(tl)]
            lines: list[list] = []
            for c in hit:
                if lines and abs(lines[-1][-1]["top"] - c["top"]) < 1.0:
                    lines[-1].append(c)
                else:
                    lines.append([c])
            for line in lines:
                out.append({
                    "x0": min(c["x0"] for c in line),
                    "x1": max(c["x1"] for c in line),
                    "top": min(c["top"] for c in line),
                    "bottom": max(c["bottom"] for c in line),
                })
    return out


def main() -> None:
    with pdfplumber.open(str(PDF)) as pdf:
        page_height = [pdf.pages[i].height for i in range(4)]
        page_width = [pdf.pages[i].width for i in range(4)]
        chemo = {str(fp): bboxes_for(pdf.pages[fp - 1], "chemosensory") for fp in range(1, 5)}
        sent = {str(fp): bboxes_for(pdf.pages[fp - 1], SENTENCE_PHRASE) for fp in range(1, 5)}

    data = {
        "fixturePages": [1, 2, 3, 4],
        "sourcePageMap": {str(k): v for k, v in SOURCE_PAGE_MAP.items()},
        "pageHeight": page_height,
        "pageWidth": page_width,
        "chemosensory": chemo,
        "sentence": sent,
        "sentencePhrase": SENTENCE_PHRASE,
    }
    OUT.write_text(json.dumps(data, indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
