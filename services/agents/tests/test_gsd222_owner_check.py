"""GSD-222 regression: /state owner check must survive a real saver round-trip.

Root cause (installed langgraph 1.1.6): ``checkpoint_ns`` is LangGraph's
*subgraph* namespace, not a storage partition — the root graph resets a
caller-supplied ``checkpoint_ns`` to ``""`` and persists under it, while the
saver keys rows by ``(thread_id, checkpoint_ns)``. GSD-207 wrote with
``checkpoint_ns=tenant-<sha>`` (silently discarded → stored under "") and read
with the same ns → ``aget_tuple`` returned None → empty transcript.

Fix: tenancy now lives in the checkpoint ``thread_id``
(``_checkpoint_thread_key`` = ``tenant-<sha>:<client_thread_id>``) which
LangGraph honors verbatim, and ``checkpoint_ns`` stays "". A foreign caller
derives a DIFFERENT storage key → the saver returns None (isolation).
AsyncPostgresSaver reconstructs the stored ``thread_id`` into
``config.configurable`` on a cold read, so the fail-closed owner check verifies
the restored key equals the caller's derived key.
"""

import hashlib
import hmac
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from routers.km_agent import _checkpoint_thread_key  # noqa: E402

CALLER = "user_1"
CLIENT_THREAD_ID = "thread-gsd222"


def _signed_headers(method: str, path: str, body: bytes = b"") -> dict[str, str]:
    timestamp = str(int(time.time()))
    signature = hmac.new(
        SECRET.encode(),
        timestamp.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": CALLER,
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": timestamp,
        "X-Inhale-Sig": signature,
        "Content-Type": "application/json",
    }


def _tuple_with_thread_key(thread_key: str) -> MagicMock:
    """A CheckpointTuple mirroring what AsyncPostgresSaver reconstructs on a
    cold read: thread_id (the derived storage key) / checkpoint_ns="" /
    checkpoint_id only — NO user_id."""
    t = MagicMock()
    t.config = {
        "configurable": {
            "thread_id": thread_key,
            "checkpoint_ns": "",
            "checkpoint_id": "checkpoint-1",
        }
    }
    t.checkpoint = {
        "channel_values": {
            "todos": [],
            "messages": [HumanMessage(content="prior message", id="m-1")],
        }
    }
    return t


def test_state_owner_check_survives_real_saver_round_trip():
    """Owner's cold read (restored thread_id == caller's derived key) → 200."""
    path = f"/agents/km/state/{CLIENT_THREAD_ID}"
    caller_key = _checkpoint_thread_key(
        thread_id=CLIENT_THREAD_ID, user_id=CALLER
    )
    mock_tuple = _tuple_with_thread_key(caller_key)
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        response = TestClient(app).get(path, headers=_signed_headers("GET", path))

    assert response.status_code == 200, response.text
    assert response.json()["messages"] == [
        {"id": "m-1", "role": "user", "text": "prior message"}
    ]
    # The endpoint MUST look up under the tenant-derived key, not the raw
    # client thread_id — otherwise cross-tenant reuse would leak.
    lookup_cfg = mock_saver.aget_tuple.await_args.args[0]
    assert lookup_cfg["configurable"]["thread_id"] == caller_key
    assert lookup_cfg["configurable"]["checkpoint_ns"] == ""


def test_state_rejects_foreign_thread_key_checkpoint():
    """A checkpoint whose restored thread_id belongs to a DIFFERENT tenant must
    403 — the owner check fails closed against cross-tenant checkpoints even if
    a saver hands one back."""
    path = f"/agents/km/state/{CLIENT_THREAD_ID}"
    foreign_key = _checkpoint_thread_key(
        thread_id=CLIENT_THREAD_ID, user_id="someone-else"
    )
    mock_tuple = _tuple_with_thread_key(foreign_key)
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        response = TestClient(app).get(path, headers=_signed_headers("GET", path))

    assert response.status_code == 403, response.text


def test_state_rejects_missing_thread_key_checkpoint():
    """Fail-closed: a restored config with no thread_id → 403 (unscoped /
    legacy state must not be trusted)."""
    path = f"/agents/km/state/{CLIENT_THREAD_ID}"
    mock_tuple = MagicMock()
    mock_tuple.config = {"configurable": {"checkpoint_ns": ""}}
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": []}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        response = TestClient(app).get(path, headers=_signed_headers("GET", path))

    assert response.status_code == 403, response.text


def test_state_missing_checkpoint_returns_empty():
    """No checkpoint (foreign tenant derives a different key → saver None) →
    200 with empty transcript, not a 500/leak."""
    path = f"/agents/km/state/{CLIENT_THREAD_ID}"
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=None)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        response = TestClient(app).get(path, headers=_signed_headers("GET", path))

    assert response.status_code == 200, response.text
    assert response.json() == {"todos": [], "pending_interrupts": [], "messages": []}
