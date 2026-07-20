"""GSD-222 regression: /state owner check must survive a real saver round-trip.

AsyncPostgresSaver (langgraph-checkpoint-postgres) persists thread_id /
checkpoint_ns / checkpoint_id as columns and reconstructs ONLY those keys into
``config.configurable`` on a cold ``aget_tuple()`` read — arbitrary keys such as
``user_id`` (stamped by ``_build_configurable`` at invoke time) are dropped.

The prior owner check compared the dropped ``user_id`` and 403'd every existing
thread, so both the reader panel and /agents/[id] rendered an empty transcript
(the km side converts the non-200 to an empty message list).

Ownership is actually enforced by the tenant ``checkpoint_ns`` that the lookup
config already scopes the query to: the saver only ever returns a row whose
``checkpoint_ns`` equals the caller's namespace. These tests pin that invariant.
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
from routers.km_agent import _checkpoint_namespace  # noqa: E402

CALLER = "user_1"


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


def _tuple_with_ns(checkpoint_ns: str) -> MagicMock:
    """A CheckpointTuple whose restored configurable mirrors what
    AsyncPostgresSaver actually reconstructs: thread_id / checkpoint_ns /
    checkpoint_id only — NO user_id."""
    t = MagicMock()
    t.config = {
        "configurable": {
            "thread_id": "thread-gsd222",
            "checkpoint_ns": checkpoint_ns,
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
    """Owner's cold read (checkpoint_ns == caller's tenant ns) → 200 + messages."""
    path = "/agents/km/state/thread-gsd222"
    mock_tuple = _tuple_with_ns(_checkpoint_namespace(CALLER))
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        response = TestClient(app).get(path, headers=_signed_headers("GET", path))

    assert response.status_code == 200, response.text
    assert response.json()["messages"] == [
        {"id": "m-1", "role": "user", "text": "prior message"}
    ]


def test_state_rejects_foreign_namespace_checkpoint():
    """A checkpoint stamped with a DIFFERENT tenant namespace must 403 — the
    owner check still fails closed against cross-tenant checkpoints."""
    path = "/agents/km/state/thread-gsd222"
    mock_tuple = _tuple_with_ns(_checkpoint_namespace("someone-else"))
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        response = TestClient(app).get(path, headers=_signed_headers("GET", path))

    assert response.status_code == 403, response.text
