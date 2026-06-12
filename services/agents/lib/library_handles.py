"""GSD-96 Round 2 — library-handle token grammar (Python side).

Grammar (locked, plan §3.1):
    [lib: kind=<paper|note|reference|paperset> id=<uuid> title="<display>"]

Lib tokens are parsed BEFORE asset tokens in the agent middleware. They are
NOT inlined as bytes; they are replaced with @<title> in the user message
and surfaced via a system-preamble (build_library_system_hint) describing
{kind, id, title} so the LLM picks the right tool:

    paper     -> read_paper(paper_id=...)
    note      -> read_note(note_id=...)
    reference -> lookup_reference(ref_id=...)
    paperset  -> list_paperset_papers(paperset_id=...) + per-paper tools

Title is display-only; the agent's tools re-resolve authoritative metadata.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


_VALID_KINDS = frozenset({"paper", "note", "reference", "paperset"})


_TOKEN_RE = re.compile(
    r'\[lib:\s+kind=(?P<kind>[a-z]+)\s+id=(?P<id>[A-Za-z0-9\-]+)\s+title="(?P<title>[^"]*)"\]'
)


@dataclass(frozen=True)
class LibraryHandle:
    kind: str
    id: str
    title: str


def parse_library_tokens(text: str) -> tuple[str, list[LibraryHandle]]:
    """Return (cleaned_text, handles) — handles in document order.

    Malformed tokens (bad kind / missing fields) are ignored and left
    in-place in the cleaned text (they will not affect downstream pipeline
    since the asset-token regex is shape-distinct).
    """
    handles: list[LibraryHandle] = []
    for m in _TOKEN_RE.finditer(text):
        kind = m.group("kind")
        if kind not in _VALID_KINDS:
            continue
        handles.append(
            LibraryHandle(kind=kind, id=m.group("id"), title=m.group("title"))
        )
    # Strip valid + invalid lib tokens — anything matching the strict regex is
    # gone. (Invalid-kind tokens with otherwise matching shape are also
    # stripped; the grammar reserves the bracketed form.)
    cleaned = _TOKEN_RE.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
    return cleaned, handles


_TOOL_FOR_KIND = {
    "paper": "read_paper",
    "note": "read_note",
    "reference": "lookup_reference",
    "paperset": "list_paperset_papers",
}


def build_library_system_hint(handles: list[LibraryHandle]) -> str:
    """Build a system-message string describing attached library items.

    Returns an empty string when no handles are present, so caller can
    conditionally include the message without branching on length.
    """
    if not handles:
        return ""
    lines = ["The user attached these library items:"]
    for h in handles:
        lines.append(f"- {h.kind} id={h.id} title={h.title!r}")
    tools_used = sorted({_TOOL_FOR_KIND[h.kind] for h in handles if h.kind in _TOOL_FOR_KIND})
    if tools_used:
        lines.append(
            "Use " + ", ".join(f"{t}(...)" for t in tools_used) + " to inspect them."
        )
    return "\n".join(lines)
