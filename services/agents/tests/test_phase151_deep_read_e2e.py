"""Phase 1.5.1 prompt-based FastAPI integration tests (RED->GREEN).

These tests hit the real FastAPI routes with auth + SSE parsing, while
mocking only the agent execution boundary.
"""

import hashlib
import hmac
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402

client = TestClient(app)


def _signed_headers(method: str, path: str, body: bytes) -> dict[str, str]:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_151",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def _parse_sse(text: str) -> list[dict]:
    events: list[dict] = []
    current_event = None
    for line in text.splitlines():
        if line.startswith("event: "):
            current_event = line[len("event: "):]
        elif line.startswith("data: "):
            events.append({"event": current_event, "data": json.loads(line[len("data: "):])})
            current_event = None
    return events


class _DiskBackedDriveLoader:
    async def load(self, only, *, user_id, tolerant=False):  # noqa: ARG002
        from skills import load_skills  # noqa: PLC0415

        return load_skills(only=only) if only else []


async def _deep_read_flow_events(input_, config, version):  # noqa: ARG001
    yield {
        "event": "on_chat_model_stream",
        "run_id": "r1",
        "data": {"chunk": MagicMock(content="Running deep-read workflow.")},
    }
    for idx, name in enumerate(
        ["search_pdfs", "pdf_read_text", "read_paper", "highlight", "create_note"],
        start=1,
    ):
        yield {
            "event": "on_tool_start",
            "run_id": f"tool-{idx}",
            "name": name,
            "data": {"input": {"step": idx}},
        }
        yield {
            "event": "on_tool_end",
            "run_id": f"tool-{idx}",
            "name": name,
            "data": {"output": {"ok": True, "tool": name}},
        }


def _fake_agent():
    agent = MagicMock()
    agent.astream_events = _deep_read_flow_events
    agent.aget_state = AsyncMock(return_value=MagicMock(tasks=[], values={}))
    return agent


@pytest.fixture(autouse=True)
def _stub_drive_loader():
    with patch("routers.km_agent.DriveSkillsLoader", _DiskBackedDriveLoader):
        yield


def test_phase151_debug_loaded_skills_includes_deep_read_and_new_tools():
    path = "/agents/km/debug/loaded_skills?only=deep-read"
    body = b""
    r = client.get(path, headers=_signed_headers("GET", path, body))
    assert r.status_code == 200
    payload = r.json()
    assert isinstance(payload, list)
    assert len(payload) == 1
    spec = payload[0]
    assert spec["name"] == "deep-read"
    tools = set(spec["tools"])
    # read_paper / pdf_explain_passage / search_library are the wired surface.
    assert {
        "read_paper",
        "pdf_read_text",
        "pdf_explain_passage",
        "search_pdfs",
        "search_library",
        "highlight",
        "create_note",
    } <= tools
    assert "extract_passages" not in tools
    assert "get_page_text" not in tools


def test_phase151_invoke_prompt_routes_through_deep_read_toolchain():
    body = json.dumps(
        {
            "thread_id": "thread-151",
            "message": "Deep-read the spontaneous switching paper and write a cited summary.",
            "enabled_skills": ["deep-read"],
        }
    ).encode()
    path = "/agents/km/invoke"
    with patch("routers.km_agent.build_km_agent", new_callable=AsyncMock, return_value=_fake_agent()) as mocked:
        r = client.post(path, content=body, headers=_signed_headers("POST", path, body))

    assert r.status_code == 200
    events = _parse_sse(r.text)
    assert "error" not in [e["event"] for e in events]

    tool_calls = [e["data"]["name"] for e in events if e["event"] == "tool_call"]
    assert "search_pdfs" in tool_calls
    assert "pdf_read_text" in tool_calls
    assert "read_paper" in tool_calls
    assert "highlight" in tool_calls
    assert "create_note" in tool_calls

    assert mocked.await_count == 1
    kwargs = mocked.await_args.kwargs
    assert kwargs["enabled_skills"] == ["deep-read"]


def test_phase151_memory_prompt_no_stale_pdf_unavailable_fence():
    from km_agent import _MEMORY_SYSTEM_PROMPT  # noqa: PLC0415

    assert "PDF full-text reading is NOT yet available in this build." not in _MEMORY_SYSTEM_PROMPT
    assert "`deep-read`" in _MEMORY_SYSTEM_PROMPT
