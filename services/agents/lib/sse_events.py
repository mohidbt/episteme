"""SSE event formatting helpers.

STUB for 1.3a — Task 7 will replace with TypedDict-typed event matrix.
"""
import json


def format_sse(event_type: str, data: dict) -> str:
    """Emit a single SSE event frame: event + data lines followed by blank line."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
