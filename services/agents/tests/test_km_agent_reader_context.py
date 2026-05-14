"""B10 — reader-context prefix must NOT mutate the persisted user message.

Before this change, ``routers/km_agent.py::invoke`` concatenated
``_build_reader_context_prefix(...)\n\n`` onto the user's text. The whole
string was then saved by the checkpointer as a HumanMessage and replayed in
the transcript UI — every history hydration showed the `[reader-context]`
preamble. Fix: keep the user's text intact and route the preamble through a
SystemMessage in the input state instead.
"""
import hashlib
import hmac
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


def _signed_headers(method: str, path: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def _make_recording_agent(captured: dict) -> MagicMock:
    """Build a mock agent whose astream_events captures its input + config."""

    async def astream_events(input_, config, version):
        captured["input"] = input_
        captured["config"] = config
        # Emit one trivial text event then stop so the SSE generator completes.
        yield {
            "event": "on_chat_model_stream",
            "run_id": "r-text",
            "data": {"chunk": MagicMock(content="ok")},
        }

    agent = MagicMock()
    agent.astream_events = astream_events
    agent.aget_state = AsyncMock(return_value=MagicMock(tasks=[]))
    return agent


def test_invoke_user_message_is_not_polluted_with_reader_context_prefix():
    """Round 4 / B10: with active paper_id, the persisted human message must
    contain ONLY the original user text. Reader-context lives elsewhere
    (system message / auxiliary block)."""
    captured: dict = {}
    body = json.dumps({
        "thread_id": "t-reader-1",
        "message": "summarize",
        "page_context": {"paperId": "paper-XYZ"},
    }).encode()

    with patch(
        "routers.km_agent.build_km_agent",
        new_callable=AsyncMock,
        return_value=_make_recording_agent(captured),
    ):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    assert r.status_code == 200, r.text
    # configurable.paper_id flow must be preserved.
    assert captured["config"]["configurable"]["paper_id"] == "paper-XYZ"

    messages = captured["input"]["messages"]

    # Find the human-role message in the input.
    def _role(m: object) -> str | None:
        if isinstance(m, dict):
            return m.get("role")
        return getattr(m, "type", None)

    def _content(m: object) -> str:
        if isinstance(m, dict):
            return m.get("content", "") or ""
        return getattr(m, "content", "") or ""

    human = [m for m in messages if _role(m) in ("user", "human")]
    assert len(human) == 1, f"expected exactly one human message, got {messages!r}"
    assert _content(human[0]) == "summarize", (
        f"human message content must be the unmodified user text, got "
        f"{_content(human[0])!r}"
    )
    assert "[reader-context]" not in _content(human[0])

    # The reader context must be carried via SOMETHING other than the human
    # message — system message or an auxiliary entry — and it must reference
    # the active paper id.
    aux_blob = "\n".join(
        _content(m) for m in messages if _role(m) not in ("user", "human")
    )
    assert "paper-XYZ" in aux_blob, (
        f"reader-context paper id must appear in a non-human message; "
        f"messages={messages!r}"
    )
    assert "[reader-context]" in aux_blob


def test_invoke_without_page_context_passes_user_message_through_unchanged():
    captured: dict = {}
    body = json.dumps({
        "thread_id": "t-plain-1",
        "message": "hello world",
    }).encode()

    with patch(
        "routers.km_agent.build_km_agent",
        new_callable=AsyncMock,
        return_value=_make_recording_agent(captured),
    ):
        r = client.post(
            "/agents/km/invoke",
            content=body,
            headers=_signed_headers("POST", "/agents/km/invoke", body),
        )

    assert r.status_code == 200, r.text

    messages = captured["input"]["messages"]

    def _role(m: object) -> str | None:
        if isinstance(m, dict):
            return m.get("role")
        return getattr(m, "type", None)

    def _content(m: object) -> str:
        if isinstance(m, dict):
            return m.get("content", "") or ""
        return getattr(m, "content", "") or ""

    human = [m for m in messages if _role(m) in ("user", "human")]
    assert len(human) == 1
    assert _content(human[0]) == "hello world"
    # No reader-context anywhere.
    blob = "\n".join(_content(m) for m in messages)
    assert "[reader-context]" not in blob
    # configurable.paper_id must NOT be set.
    assert "paper_id" not in captured["config"]["configurable"]
