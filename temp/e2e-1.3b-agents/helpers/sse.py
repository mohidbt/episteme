"""Minimal SSE iterator for the agents service stream.

Event matrix lives at services/agents/docs/sse-event-matrix.md.
Event types in scope: text, tool_call, tool_result, interrupt, todos, sources,
skill_load, suggestion, thinking, file_diff, done.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx


async def parse_sse(resp: httpx.Response) -> AsyncIterator[tuple[str, dict]]:
    """Yield (event_type, data_dict) for each SSE event."""
    buf_event = None
    buf_data: list[str] = []
    async for line in resp.aiter_lines():
        if line == "":
            if buf_event and buf_data:
                payload = "\n".join(buf_data)
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    data = {"raw": payload}
                yield buf_event, data
            buf_event = None
            buf_data = []
            continue
        if line.startswith("event:"):
            buf_event = line[6:].strip()
        elif line.startswith("data:"):
            buf_data.append(line[5:].lstrip())


async def collect_until_done(resp: httpx.Response) -> list[tuple[str, dict]]:
    """Drain the stream into a list. Stops at the first `done` event."""
    out: list[tuple[str, dict]] = []
    async for ev, data in parse_sse(resp):
        out.append((ev, data))
        if ev == "done":
            break
    return out


def find_first(events: list[tuple[str, dict]], event_type: str) -> dict | None:
    for ev, data in events:
        if ev == event_type:
            return data
    return None


def find_all(events: list[tuple[str, dict]], event_type: str) -> list[dict]:
    return [data for ev, data in events if ev == event_type]
