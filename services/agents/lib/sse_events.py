"""SSE event formatting helpers — v1 matrix locked in 1.3a (Task 7).

Defines TypedDicts for all 11 event types and provides two formatters:
  format_sse(event_type, data) — unvalidated, existing call sites unchanged
  format_typed(event_type, payload) — validates required keys, fails fast in dev
"""
import json
from typing import Any, Literal, NotRequired, TypedDict


# ---------------------------------------------------------------------------
# TypedDicts — one per SSE event type
# ---------------------------------------------------------------------------

class TextEvent(TypedDict):
    id: str
    delta: str


class ThinkingEvent(TypedDict):
    id: str
    step_id: NotRequired[str]
    delta: str


class ToolCallEvent(TypedDict):
    id: str
    name: str
    args: dict[str, Any]
    state: Literal["input-available"]


class ToolResultEvent(TypedDict):
    id: str
    output: NotRequired[Any]
    errorText: NotRequired[str]
    state: Literal["output-available", "output-error"]


class InterruptEvent(TypedDict):
    id: str
    tool: str
    args: dict[str, Any]
    allowed_decisions: list[str]


class TodosItem(TypedDict):
    id: str
    content: str
    status: Literal["pending", "in_progress", "completed"]


class TodosEvent(TypedDict):
    items: list[TodosItem]


class Citation(TypedDict):
    chunk_id: str
    title: NotRequired[str]
    url: NotRequired[str]
    page: NotRequired[int]


class SourcesEvent(TypedDict):
    message_id: str
    citations: list[Citation]


class SkillLoadEvent(TypedDict):
    name: str


class FileDiffEvent(TypedDict):
    note_id: str
    before_hash: str
    after_hash: str
    diff: str


class SuggestionEvent(TypedDict):
    items: list[str]


class DoneEvent(TypedDict):
    thread_id: str


# ---------------------------------------------------------------------------
# EventType literal + required-key map (drives format_typed validation)
# ---------------------------------------------------------------------------

EventType = Literal[
    "text", "thinking", "tool_call", "tool_result", "interrupt",
    "todos", "sources", "skill_load", "file_diff", "suggestion", "done",
]

_REQUIRED_KEYS: dict[str, frozenset[str]] = {
    "text":       frozenset({"id", "delta"}),
    "thinking":   frozenset({"id", "delta"}),
    "tool_call":  frozenset({"id", "name", "args", "state"}),
    "tool_result": frozenset({"id", "state"}),
    "interrupt":  frozenset({"id", "tool", "args", "allowed_decisions"}),
    "todos":      frozenset({"items"}),
    "sources":    frozenset({"message_id", "citations"}),
    "skill_load": frozenset({"name"}),
    "file_diff":  frozenset({"note_id", "before_hash", "after_hash", "diff"}),
    "suggestion": frozenset({"items"}),
    "done":       frozenset({"thread_id"}),
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def format_sse(event_type: str, data: dict) -> str:
    """Emit a single SSE event frame: event + data lines followed by blank line."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


def format_typed(event_type: EventType, payload: dict) -> str:
    """Validate required keys are present, then emit the SSE frame.

    Raises ValueError with a descriptive message if required keys are missing.
    Use this in all new emitters so shape errors surface immediately in dev.
    """
    required = _REQUIRED_KEYS.get(event_type)
    if required is None:
        raise ValueError(f"Unknown event type: {event_type!r}")
    missing = required - payload.keys()
    if missing:
        raise ValueError(
            f"SSE event {event_type!r} missing required keys: {sorted(missing)}"
        )
    return format_sse(event_type, payload)
