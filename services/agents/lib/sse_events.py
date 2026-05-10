"""SSE event formatting helpers — v1 matrix locked in 1.3a (Task 7).

Defines TypedDicts for all 11 event types and provides two formatters:
  format_sse(event_type, data) — unvalidated, existing call sites unchanged
  format_typed(event_type, payload) — validates required keys, fails fast in dev
"""
import dataclasses
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
    paper_id: NotRequired[str]
    title: NotRequired[str]
    url: NotRequired[str]
    page: NotRequired[int]
    snippet: NotRequired[str]
    bbox: NotRequired[dict[str, float] | None]


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


class ErrorEvent(TypedDict):
    code: str
    message: str
    retriable: bool


class RecursionStepEvent(TypedDict):
    step: int


class PdfExtractProgressEvent(TypedDict):
    paper_id: str
    stage: str


# ---------------------------------------------------------------------------
# EventType literal + required-key map (drives format_typed validation)
# ---------------------------------------------------------------------------

EventType = Literal[
    "text", "thinking", "tool_call", "tool_result", "interrupt",
    "todos", "sources", "skill_load", "file_diff", "suggestion", "done",
    "error", "recursion_step", "pdf_extract_progress",
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
    "error":      frozenset({"code", "message", "retriable"}),
    "recursion_step": frozenset({"step"}),
    "pdf_extract_progress": frozenset({"paper_id", "stage"}),
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def _jsonable(value: Any) -> Any:
    """Convert LangGraph / LangChain runtime objects to JSON-friendly shapes.

    Deep Agents built-in tools (write_todos, edit_file, task subagent) return
    `langgraph.types.Command` from `on_tool_end`. Without conversion, the SSE
    encoder hits ``TypeError: Object of type Command is not JSON serializable``
    and tears down the stream mid-flight (§1.3b-E2E-fix-1).

    Strategy:
    - Command (dataclass) → ``{"update": ..., "goto": ..., "resume": ..., "graph": ...}``
      (drops keys whose values are None / empty tuple — the dataclass default).
    - BaseMessage-like (has ``.content``) → its content (already covered upstream
      but belt-and-suspenders here for arbitrary nested values).
    - dataclass → ``dataclasses.asdict``.
    - dict / list / tuple → recurse.
    - Anything else with ``model_dump`` (pydantic) → ``model_dump()``.
    - Otherwise → return unchanged; ``json.dumps`` can still raise for genuinely
      foreign types (callers should treat that as a real bug, not a runtime
      TypeError to swallow).
    """
    # Avoid hard imports of langgraph at module load — keep this helper
    # import-light. ``Command`` is a dataclass, so the dataclass path covers it.
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        # Drop None/empty-tuple keys so the wire shape stays compact.
        as_dict = dataclasses.asdict(value)
        return {k: _jsonable(v) for k, v in as_dict.items() if v not in (None, (), [])}
    if hasattr(value, "model_dump"):
        try:
            dumped = value.model_dump()
        except Exception:  # noqa: BLE001 — pydantic v1/v2 + custom failures
            dumped = None
        # Guard: MagicMock and similar duck-typed objects auto-create
        # `model_dump` and return another mock, causing infinite recursion.
        # Real pydantic returns dict; pydantic v1 dict()-shape also dict.
        if isinstance(dumped, (dict, list)):
            return _jsonable(dumped)
    if hasattr(value, "content"):
        content = getattr(value, "content")
        # Same guard: only recurse when content is a real JSON-friendly shape.
        if isinstance(content, (str, int, float, bool, dict, list)) or content is None:
            return _jsonable(content)
    return value


def format_sse(event_type: str, data: dict) -> str:
    """Emit a single SSE event frame: event + data lines followed by blank line.

    The payload is run through ``_jsonable`` so LangGraph runtime objects
    (Command, BaseMessage, pydantic models) cannot crash ``json.dumps``.
    """
    return f"event: {event_type}\ndata: {json.dumps(_jsonable(data))}\n\n"


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
