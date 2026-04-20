import asyncio
import json
import os
import re
from collections.abc import Awaitable, Callable
from difflib import SequenceMatcher

import anyio
import pdfplumber
from langchain_core.tools import tool
from pydantic import BaseModel, Field, ValidationError
from pypdf import PdfReader

from lib.openrouter_client import embed_texts


class HighlightRect(BaseModel):
    page: int = Field(description="1-indexed page number this rect lives on.")
    x0: float = Field(description="Left edge, PDF page coords.")
    y0: float = Field(description="Bottom edge, PDF page coords.")
    x1: float = Field(description="Right edge, PDF page coords.")
    y1: float = Field(description="Top edge, PDF page coords.")


class HighlightMatch(BaseModel):
    page_number: int = Field(description="1-indexed page number of the match.")
    text_content: str = Field(
        min_length=1, description="Exact text being highlighted (non-empty)."
    )
    start_offset: int = Field(description="Character start offset from locate_phrase.")
    end_offset: int = Field(description="Character end offset from locate_phrase.")
    rects: list[HighlightRect] = Field(
        min_length=1,
        description="Non-empty list of page-coord rects from locate_phrase.",
    )


class CreateHighlightsArgs(BaseModel):
    matches: list[HighlightMatch] = Field(
        min_length=1,
        description=(
            "Non-empty list of highlight matches. Each item must have "
            "page_number, text_content, start_offset, end_offset, rects. "
            "Do NOT call create_highlights with an empty list or no arguments."
        ),
    )

MAX_HIGHLIGHTS_PER_RUN = 50
MAX_LOCATE_HITS = 20

TOOLBELT_SYSTEM_HINT = (
    "When the user explicitly asks to highlight / mark / annotate passages, use the highlight toolset:\n"
    "  1. `semantic_search` ONCE to find candidate passages.\n"
    "  2. For each top candidate, call `page_text` then `locate_phrase` for exact offsets and rects.\n"
    "  3. `create_highlights` ONCE with the full batch of matches (map locate_phrase results to "
    "`{page_number, text_content, start_offset, end_offset, rects}`).\n"
    "  4. `finish` with a 1-2 sentence summary. ALWAYS call `finish` after `create_highlights`.\n"
    "Cap: 50 highlights per run. Do not loop — one search, one batch, then finish. "
    "If `create_highlights` returns `capped: true` or inserted 0, call `finish` immediately."
)


def build_tools(
    conn,
    user_id: str,
    document_id: int,
    get_run_id: Callable[[], Awaitable[str]],
    api_key: str,
    pdf_path: str,
    conn_lock: asyncio.Lock | None = None,
) -> list:
    """Build the auto-highlight tool set with context closed over by each @tool.

    `get_run_id` is an async callable that returns the run_id. It is only
    awaited lazily on the first `create_highlights` call, and its result is
    cached for the remainder of the run.

    `conn_lock` serializes access to the shared asyncpg `conn` across
    concurrent tool calls (OpenRouter/OpenAI can emit parallel tool calls
    despite `parallel_tool_calls=False`). If omitted, a new lock is created
    internally for this tool set.
    """

    if conn_lock is None:
        conn_lock = asyncio.Lock()

    cached: str | None = None

    async def _run_id() -> str:
        nonlocal cached
        if cached is None:
            cached = await get_run_id()
        return cached

    @tool
    async def semantic_search(query: str, top_k: int = 8) -> list[dict]:
        """Use this toolset only when the user explicitly asks to highlight / mark / annotate passages.

        Examples:
          YES — "Highlight the passages where the dataset is discussed"
          YES — "Mark every mention of the attention mechanism"
          NO  — "What's the methodology?" — answer inline, do NOT call this tool.

        ---

        Search the document for passages semantically related to `query`.

        Returns the top_k most similar chunks as
        `{chunk_id, page, page_start, page_end, content, score}`. Use this
        first to locate candidate pages before drilling into `page_text` or
        `locate_phrase`.
        """
        vecs = await embed_texts(api_key, [query])
        async with conn_lock:
            rows = await conn.fetch(
                "SELECT id, content, page_start, page_end, "
                "(1 - (embedding <=> $2::vector)) AS score "
                "FROM document_chunks "
                "WHERE document_id = $1 AND embedding IS NOT NULL "
                "ORDER BY score DESC LIMIT $3",
                document_id,
                vecs[0],
                top_k,
            )
        return [
            {
                "chunk_id": r["id"],
                "page": r["page_start"],
                "page_start": r["page_start"],
                "page_end": r["page_end"],
                "content": r["content"],
                "score": float(r["score"]),
            }
            for r in rows
        ]

    @tool
    async def page_text(page_number: int) -> dict:
        """Return the full plain-text contents of a single PDF page.

        `page_number` is 1-indexed. Returns `{page, text, char_count}`, or
        `{error}` if the page is out of range. Use this to read the full
        context around a candidate passage before calling `locate_phrase`.
        """

        def _load():
            reader = PdfReader(pdf_path)
            if page_number < 1 or page_number > len(reader.pages):
                return None
            return reader.pages[page_number - 1].extract_text() or ""

        text = await anyio.to_thread.run_sync(_load)
        if text is None:
            return {"error": f"page {page_number} out of range"}
        return {"page": page_number, "text": text, "char_count": len(text)}

    @tool
    async def locate_phrase(phrase: str, page_number: int) -> list[dict]:
        """Find every occurrence of `phrase` on `page_number` and return
        character offsets + approximate page-coordinate rects.

        Exact match is case-insensitive. If no exact matches and env var
        `AUTO_HIGHLIGHT_FUZZY=1` is set, falls back to fuzzy word-window
        matching. Caps at 20 results. Returns
        `[{start_offset, end_offset, text, rects: [{page, x0, y0, x1, y1}]}]`.
        """
        text, fragments = await anyio.to_thread.run_sync(
            lambda: _extract_with_positions(pdf_path, page_number)
        )
        if text is None:
            return []

        hits = _find_exact(text, phrase)
        if not hits and os.environ.get("AUTO_HIGHLIGHT_FUZZY") == "1":
            hits = _find_fuzzy(text, phrase)

        reader = PdfReader(pdf_path)
        mb = reader.pages[page_number - 1].mediabox
        page_x_max = float(mb.right)
        results = []
        for start, end in hits[:MAX_LOCATE_HITS]:
            rects = _rect_for_span(fragments, start, end, page_number, page_x_max)
            results.append(
                {
                    "start_offset": start,
                    "end_offset": end,
                    "text": text[start:end],
                    "rects": rects,
                }
            )
        return results

    @tool(args_schema=CreateHighlightsArgs)
    async def create_highlights(matches: list[dict]) -> dict:
        """Persist a batch of highlights. Use ONLY when the user explicitly asked to highlight / mark / annotate passages.

        You MUST pass a non-empty `matches` list. Calling this tool with no
        arguments, `matches=[]`, or `matches=null` is INVALID and will error.
        Each match MUST contain: page_number, text_content, start_offset,
        end_offset, rects (populated from locate_phrase results).

        If you have no matches to create, do NOT call this tool — respond
        with prose instead. Do not use this tool as a "finish" signal;
        call `finish` for that.

        Inserts tagged source='ai-auto', color='amber', layer_id=run.
        Hard-capped at 50/run; returns `{inserted, total_in_run, capped}`.
        """
        if not matches:
            return {
                "error": (
                    "ERROR: create_highlights requires a non-empty 'matches' list. "
                    "Each match needs page_number, text_content, start_offset, "
                    "end_offset, rects. If you have no matches, do not call this tool."
                )
            }
        # args_schema may pass pydantic models; normalize to dicts for DB access.
        matches = [m.model_dump() if isinstance(m, BaseModel) else m for m in matches]
        run_id = await _run_id()
        async with conn_lock:
            existing = await conn.fetchval(
                "SELECT COUNT(*) FROM user_highlights WHERE layer_id = $1::uuid",
                run_id,
            )
            existing = int(existing or 0)
            remaining = MAX_HIGHLIGHTS_PER_RUN - existing
            to_insert = matches[: max(0, remaining)]
            capped = (
                len(to_insert) < len(matches)
                or (existing + len(to_insert)) >= MAX_HIGHLIGHTS_PER_RUN
            )

            for m in to_insert:
                rects_json = json.dumps(m.get("rects", []))
                await conn.execute(
                    "INSERT INTO user_highlights "
                    "(user_id, document_id, page_number, text_content, start_offset, "
                    "end_offset, color, source, layer_id, rects) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10::jsonb)",
                    user_id,
                    document_id,
                    m["page_number"],
                    m["text_content"],
                    m["start_offset"],
                    m["end_offset"],
                    "amber",
                    "ai-auto",
                    run_id,
                    rects_json,
                )

        total = existing + len(to_insert)
        return {"inserted": len(to_insert), "total_in_run": total, "capped": capped}

    @tool
    async def finish(summary: str) -> dict:
        """End the tool loop. Call this once after all relevant highlights
        have been created. `summary` is a 1-2 sentence description of what
        was highlighted (shown to the user).
        """
        return {"summary": summary, "done": True}

    def _on_validation_error(err: ValidationError) -> str:
        return (
            "ERROR: create_highlights requires a non-empty 'matches' list. "
            "Each match needs page_number, text_content, start_offset, "
            "end_offset, rects (from locate_phrase). If you have no matches "
            "to create, do not call this tool — respond with prose instead. "
            f"Details: {err.errors(include_url=False, include_input=False)}"
        )

    create_highlights.handle_validation_error = _on_validation_error

    return [semantic_search, page_text, locate_phrase, create_highlights, finish]


# ----- helpers ---------------------------------------------------------------


# Sliver threshold matching the legacy run `3a2e170b` symptom: pre-mitigation
# rects collapsed to ~6×1pt boxes when the pypdf fragment matcher fell through
# to the `fsz × 0.5` approximation. Task 52 uses this predicate to decide when
# to offer the user a "Rebuild" action. Keep the TypeScript copy in
# `highlights-sidebar.tsx` literally equivalent.
STALE_RECT_MIN_WIDTH = 5.0
STALE_RECT_MIN_HEIGHT = 2.0


def is_stale_rect(rect: dict) -> bool:
    """True if `rect` looks like a legacy sliver (width<5 AND height<2).

    Both conditions must hold — a rect with normal width but tiny height
    (or vice-versa) is not stale; only the degenerate sliver shape is.
    """
    width = float(rect["x1"]) - float(rect["x0"])
    height = float(rect["y1"]) - float(rect["y0"])
    return width < STALE_RECT_MIN_WIDTH and height < STALE_RECT_MIN_HEIGHT


def _extract_with_positions(pdf_path: str, page_number: int):
    """Return (full_text, fragments).

    Text and offsets come from pypdf's `visitor_text` so the stream shape
    (including inline concatenations from adjacent text-show ops) is
    preserved. Per-glyph bboxes come from pdfplumber's `page.chars`: for
    each fragment we look up a contiguous run of plumber chars whose text
    matches the fragment and whose origin is near pypdf's (tm_x, tm_y).

    Each fragment is `(cursor, origin, eff_size, glyphs)`:
      - `cursor` — absolute char offset in `full_text`
      - `origin` — pypdf `(tm_x, tm_y)` for the fragment, used as a
        fallback anchor when no plumber glyph matches
      - `eff_size` — effective font size in pts
      - `glyphs` — a list aligned to the fragment text; each entry is either
        the pdfplumber char dict for that character or `None` when no
        plumber match exists (synthesised `\n`/whitespace in the pypdf
        stream, or the rare XObject duplicate pdfplumber does not render).
        On the chemosensory fixture this fallback fires on <0.5% of chars
        after the whitespace-insensitive matcher in `_match_fragment_glyphs`.
    """
    reader = PdfReader(pdf_path)
    if page_number < 1 or page_number > len(reader.pages):
        return None, []
    page = reader.pages[page_number - 1]

    with pdfplumber.open(pdf_path) as pdf:
        plumber_chars = pdf.pages[page_number - 1].chars

    fragments: list[tuple[int, tuple[float, float], float, list]] = []
    parts: list[str] = []
    cursor = 0

    def visitor(text, cm, tm, font_dict, font_size):
        nonlocal cursor
        if not text:
            return
        origin_x = float(tm[4]) if tm else 0.0
        origin_y = float(tm[5]) if tm else 0.0
        stated = float(font_size or 1.0)
        tm_scale = abs(float(tm[0])) if tm else 1.0
        cm_scale = abs(float(cm[0])) if cm else 1.0
        eff_size = stated * tm_scale * cm_scale
        if eff_size < 2.0:
            eff_size = 10.0
        glyphs = _match_fragment_glyphs(text, origin_x, origin_y, plumber_chars)
        fragments.append((cursor, (origin_x, origin_y), eff_size, glyphs))
        parts.append(text)
        cursor += len(text)

    page.extract_text(visitor_text=visitor)
    return "".join(parts), fragments


def _match_fragment_glyphs(
    text: str, origin_x: float, origin_y: float, plumber_chars: list
) -> list:
    """Locate the pdfplumber chars for a pypdf text fragment.

    Find a contiguous run in `plumber_chars` whose non-whitespace text
    matches `text`'s non-whitespace text glyph-for-glyph. pypdf and
    pdfplumber tokenize whitespace differently (e.g. pypdf inserts a
    space before a superscript where plumber sees none), so matching
    strictly on every glyph would drop entire multi-word fragments into
    the approximation fallback. We compare only the non-whitespace
    glyphs and map each back to its original position in `text`.

    Prefer a run whose y0 is within ~6pt of the pypdf baseline
    `origin_y`; among ties, prefer the one whose x0 is closest to
    `origin_x`. Returns a list aligned to `text`: entry `i` is the
    plumber char for `text[i]`, or `None` when there is no match
    (e.g. synthesised newline in `text`, or whitespace that doesn't
    exist in the plumber stream).
    """
    n = len(plumber_chars)
    tlen = len(text)

    # Needle: non-whitespace chars from pypdf text, with their indices in `text`.
    needle_indices: list[int] = []
    needle: list[str] = []
    for i, ch in enumerate(text):
        if ch.isspace():
            continue
        needle_indices.append(i)
        needle.append(ch)
    if not needle:
        return [None] * tlen
    nl = len(needle)

    # Haystack: precompute non-whitespace char indices in plumber_chars so we
    # can compare non-whitespace glyph-for-glyph while still returning the
    # real plumber char refs (whitespace included) to the caller.
    hay_nonws: list[int] = []
    for i, c in enumerate(plumber_chars):
        t = c.get("text") or ""
        if t and not t.isspace():
            hay_nonws.append(i)
    hn = len(hay_nonws)

    def _pack(hay_start_nonws: int) -> list:
        """Map each needle index → plumber char at the corresponding
        non-whitespace position in the haystack."""
        out: list = [None] * tlen
        for k, ni in enumerate(needle_indices):
            out[ni] = plumber_chars[hay_nonws[hay_start_nonws + k]]
        return out

    near_hits: list[int] = []  # indices into hay_nonws
    any_hits: list[int] = []
    for s in range(hn - nl + 1):
        ok = True
        for k in range(nl):
            if plumber_chars[hay_nonws[s + k]].get("text") != needle[k]:
                ok = False
                break
        if not ok:
            continue
        any_hits.append(s)
        if abs(plumber_chars[hay_nonws[s]]["y0"] - origin_y) < 6.0:
            near_hits.append(s)

    if near_hits:
        best = min(
            near_hits,
            key=lambda s: abs(plumber_chars[hay_nonws[s]]["x0"] - origin_x),
        )
        return _pack(best)
    if any_hits:
        best = min(
            any_hits,
            key=lambda s: (
                abs(plumber_chars[hay_nonws[s]]["y0"] - origin_y),
                abs(plumber_chars[hay_nonws[s]]["x0"] - origin_x),
            ),
        )
        return _pack(best)
    return [None] * tlen


def _find_exact(text: str, phrase: str) -> list[tuple[int, int]]:
    if not phrase:
        return []
    pattern = re.compile(re.escape(phrase), re.IGNORECASE)
    return [(m.start(), m.end()) for m in pattern.finditer(text)]


def _find_fuzzy(
    text: str, phrase: str, threshold: float = 0.82
) -> list[tuple[int, int]]:
    """Simple fuzzy: slide a word-window of phrase length over text, keep spans
    whose SequenceMatcher ratio exceeds `threshold`. Deduped + non-overlapping.
    """
    words = [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]
    plen = len(phrase.split()) or 1
    hits: list[tuple[int, int]] = []
    for i in range(len(words) - plen + 1):
        start = words[i][0]
        end = words[i + plen - 1][1]
        window = text[start:end]
        if SequenceMatcher(None, window.lower(), phrase.lower()).ratio() >= threshold:
            if not hits or start >= hits[-1][1]:
                hits.append((start, end))
    return hits


def _rect_for_span(
    fragments, start: int, end: int, page_number: int, page_x_max: float = 1e9
) -> list[dict]:
    """Return one rect per visual line the span [start, end) covers.

    Each fragment is `(cursor, origin, eff_size, glyphs)`; `glyphs[i]` is
    the pdfplumber char dict for `text[cursor + i]` or `None`. Matched
    glyphs contribute their real per-glyph bboxes. A fragment with no
    plumber matches falls back to a synthetic bbox anchored at pypdf's
    origin with `eff_size × 0.5` per-char advance. After the
    whitespace-insensitive matcher in `_match_fragment_glyphs`, this
    fallback fires on <0.5% of chars on the chemosensory fixture
    (duplicated XObject content pdfplumber skips, or rare edge cases
    where no run of plumber glyphs aligns with the pypdf fragment).
    Boxes are grouped into y-bands (±0.5pt jitter) and each band
    yields one rect, clamped to `page_x_max` on the right.
    """
    if start >= end:
        return []
    boxes: list[tuple[float, float, float, float]] = []  # (x0, y0, x1, y1)
    for (cursor, origin, eff_size, glyphs) in fragments:
        frag_end = cursor + len(glyphs)
        if frag_end <= start or cursor >= end:
            continue
        lo = max(0, start - cursor)
        hi = min(len(glyphs), end - cursor)
        slice_glyphs = glyphs[lo:hi]
        matched = [g for g in slice_glyphs if g is not None]
        if matched:
            for g in matched:
                boxes.append((g["x0"], g["y0"], g["x1"], g["y1"]))
            continue
        # Fallback: pypdf-only fragment. Synthesise a rect at its origin.
        ox, oy = origin
        char_n = hi - lo
        if char_n <= 0:
            continue
        approx = eff_size * 0.5
        fx0 = ox + max(0, lo) * approx
        fx1 = ox + (lo + char_n) * approx
        boxes.append((fx0, oy, fx1, oy + eff_size))
    if not boxes:
        return []
    lines: list[list] = []
    for box in boxes:
        if lines and abs(lines[-1][-1][1] - box[1]) < 0.5:
            lines[-1].append(box)
        else:
            lines.append([box])
    rects: list[dict] = []
    for line in lines:
        x0 = min(b[0] for b in line)
        y0 = min(b[1] for b in line)
        x1 = max(b[2] for b in line)
        y1 = max(b[3] for b in line)
        x0 = min(x0, page_x_max)
        x1 = min(x1, page_x_max)
        rects.append(
            {
                "page": page_number,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
            }
        )
    return rects
