"""RED → GREEN tests for /agents/km/extract real SSE handler (Phase 1.4.x-T6).

Replaces the 501 stub from phase-1.4 T0. Per-cell fan-out via deepagent +
data-extract skill, asyncio.Semaphore(4) cap, failure isolation.

Mocks at two boundaries:
  - ``routers.km_agent.km_get`` for the paperset metadata fetch.
  - ``routers.km_agent.build_km_agent`` for the agent factory.
"""
import asyncio
import hashlib
import hmac
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


def _parse_sse(text: str) -> list[dict]:
    events = []
    current = None
    for line in text.splitlines():
        if line.startswith("event: "):
            current = line[len("event: "):]
        elif line.startswith("data: "):
            data = json.loads(line[len("data: "):])
            events.append({"event": current, "data": data})
            current = None
    return events


_DEFAULT_PAPERSET = {
    "file_id": "pset-1",
    "columns": [
        {"name": "n_subjects", "description": "Number of human subjects."},
        {"name": "study_type", "description": "Study type."},
    ],
    "row_refs": [
        {"paper_id": "paper-A"},
        {"paper_id": "paper-B"},
    ],
    "cells": {},
}


def _build_agent_with_events(per_cell_events_by_thread):
    """Build an agent mock whose `astream_events` yields per-thread scripted events.

    `per_cell_events_by_thread` is a dict of thread_id → either:
      - list of event dicts (mapped via `_map_event`)
      - Exception (raised when astream_events is iterated)
    """
    agent = MagicMock()

    async def astream_events(input_, config, version):  # noqa: ARG001
        thread_id = config["configurable"]["thread_id"]
        spec = per_cell_events_by_thread.get(thread_id, [])
        if isinstance(spec, Exception):
            raise spec
        for ev in spec:
            yield ev

    agent.astream_events = astream_events
    return agent


def _csv_write_cell_event(row, col, value, paper_id, block_ids):
    """Compose on_tool_start + on_tool_end pair for a successful csv_write_cell call."""
    args = {
        "file_id": "pset-1",
        "row": row,
        "col": col,
        "value": value,
        "grounding": {"paper_id": paper_id, "block_ids": block_ids},
    }
    output_msg = MagicMock(content="ok")
    return [
        {
            "event": "on_tool_start",
            "run_id": f"rs-{row}-{col}",
            "name": "csv_write_cell",
            "data": {"input": args},
        },
        {
            "event": "on_tool_end",
            "run_id": f"rs-{row}-{col}",
            "name": "csv_write_cell",
            "data": {"input": args, "output": output_msg},
        },
    ]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_extract_requires_auth():
    body = json.dumps(
        {"paperset_id": "pset-1", "cells": [{"row_idx": 0, "col_name": "n_subjects"}]}
    ).encode()
    r = client.post("/agents/km/extract", content=body)
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_extract_rejects_empty_cells():
    body = json.dumps({"paperset_id": "pset-1", "cells": []}).encode()
    headers = _signed_headers("POST", "/agents/km/extract", body)
    r = client.post("/agents/km/extract", content=body, headers=headers)
    assert r.status_code == 400


def test_extract_rejects_row_oob():
    body = json.dumps(
        {"paperset_id": "pset-1", "cells": [{"row_idx": 99, "col_name": "n_subjects"}]}
    ).encode()
    headers = _signed_headers("POST", "/agents/km/extract", body)
    with patch(
        "routers.km_agent.km_get",
        new_callable=AsyncMock,
        return_value=_DEFAULT_PAPERSET,
    ):
        r = client.post("/agents/km/extract", content=body, headers=headers)
    assert r.status_code == 400
    assert "row_oob" in r.text


def test_extract_rejects_unknown_col():
    body = json.dumps(
        {"paperset_id": "pset-1", "cells": [{"row_idx": 0, "col_name": "nope"}]}
    ).encode()
    headers = _signed_headers("POST", "/agents/km/extract", body)
    with patch(
        "routers.km_agent.km_get",
        new_callable=AsyncMock,
        return_value=_DEFAULT_PAPERSET,
    ):
        r = client.post("/agents/km/extract", content=body, headers=headers)
    assert r.status_code == 400
    assert "unknown_col" in r.text


# ---------------------------------------------------------------------------
# Smoke: 2 cells succeed
# ---------------------------------------------------------------------------


def test_extract_smoke_two_cells_succeed():
    cells = [
        {"row_idx": 0, "col_name": "n_subjects"},
        {"row_idx": 1, "col_name": "study_type"},
    ]
    body = json.dumps({"paperset_id": "pset-1", "cells": cells}).encode()
    headers = _signed_headers("POST", "/agents/km/extract", body)

    per_thread = {
        "extract:pset-1:0:n_subjects": _csv_write_cell_event(
            0, "n_subjects", "42", "paper-A", ["paper-A:7"]
        ),
        "extract:pset-1:1:study_type": _csv_write_cell_event(
            1, "study_type", "RCT", "paper-B", ["paper-B:3"]
        ),
    }
    agent = _build_agent_with_events(per_thread)

    with patch(
        "routers.km_agent.km_get",
        new_callable=AsyncMock,
        return_value=_DEFAULT_PAPERSET,
    ), patch(
        "routers.km_agent.build_km_agent",
        new_callable=AsyncMock,
        return_value=agent,
    ):
        r = client.post("/agents/km/extract", content=body, headers=headers)

    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]

    events = _parse_sse(r.text)
    types = [e["event"] for e in events]

    assert types.count("cell_started") == 2
    assert types.count("cell_update") == 2
    assert types.count("done") == 1

    filled = [e["data"] for e in events if e["event"] == "cell_update"]
    by_key = {(d["row"], d["col"]): d for d in filled}
    assert by_key[(0, "n_subjects")]["value"] == "42"
    assert by_key[(0, "n_subjects")]["grounding"]["block_ids"] == ["paper-A:7"]
    assert by_key[(1, "study_type")]["value"] == "RCT"

    done = [e["data"] for e in events if e["event"] == "done"][0]
    assert done == {"filled": 2, "failed": 0}


# ---------------------------------------------------------------------------
# Failure isolation: cell 0 raises, cell 1 succeeds
# ---------------------------------------------------------------------------


def test_extract_failure_isolation():
    cells = [
        {"row_idx": 0, "col_name": "n_subjects"},
        {"row_idx": 1, "col_name": "study_type"},
    ]
    body = json.dumps({"paperset_id": "pset-1", "cells": cells}).encode()
    headers = _signed_headers("POST", "/agents/km/extract", body)

    per_thread = {
        "extract:pset-1:0:n_subjects": RuntimeError("boom"),
        "extract:pset-1:1:study_type": _csv_write_cell_event(
            1, "study_type", "RCT", "paper-B", ["paper-B:3"]
        ),
    }
    agent = _build_agent_with_events(per_thread)

    with patch(
        "routers.km_agent.km_get",
        new_callable=AsyncMock,
        return_value=_DEFAULT_PAPERSET,
    ), patch(
        "routers.km_agent.build_km_agent",
        new_callable=AsyncMock,
        return_value=agent,
    ):
        r = client.post("/agents/km/extract", content=body, headers=headers)

    assert r.status_code == 200
    events = _parse_sse(r.text)
    types = [e["event"] for e in events]
    assert types.count("cell_started") == 2
    assert types.count("cell_failed") == 1
    assert types.count("cell_update") == 1
    assert types.count("done") == 1

    failed = [e["data"] for e in events if e["event"] == "cell_failed"][0]
    assert failed["row"] == 0
    assert failed["col"] == "n_subjects"
    assert "boom" in failed["error"]

    done = [e["data"] for e in events if e["event"] == "done"][0]
    assert done == {"filled": 1, "failed": 1}


# ---------------------------------------------------------------------------
# Concurrency cap: 8 cells dispatched, max in-flight == 4
# ---------------------------------------------------------------------------


def test_extract_concurrency_cap_4():
    pset = {
        "file_id": "pset-1",
        "columns": [{"name": f"c{i}", "description": "x"} for i in range(8)],
        "row_refs": [{"paper_id": "paper-A"}],
        "cells": {},
    }
    cells = [{"row_idx": 0, "col_name": f"c{i}"} for i in range(8)]
    body = json.dumps({"paperset_id": "pset-1", "cells": cells}).encode()
    headers = _signed_headers("POST", "/agents/km/extract", body)

    in_flight = 0
    max_in_flight = 0
    lock = asyncio.Lock()

    async def slow_astream(input_, config, version):  # noqa: ARG001
        nonlocal in_flight, max_in_flight
        async with lock:
            in_flight += 1
            if in_flight > max_in_flight:
                max_in_flight = in_flight
        try:
            # Yield enough turns to ensure overlap.
            await asyncio.sleep(0.05)
            col = config["configurable"]["thread_id"].split(":")[-1]
            for ev in _csv_write_cell_event(0, col, "v", "paper-A", ["paper-A:1"]):
                yield ev
            await asyncio.sleep(0.05)
        finally:
            async with lock:
                in_flight -= 1

    agent = MagicMock()
    agent.astream_events = slow_astream

    with patch(
        "routers.km_agent.km_get",
        new_callable=AsyncMock,
        return_value=pset,
    ), patch(
        "routers.km_agent.build_km_agent",
        new_callable=AsyncMock,
        return_value=agent,
    ):
        r = client.post("/agents/km/extract", content=body, headers=headers)

    assert r.status_code == 200
    events = _parse_sse(r.text)
    types = [e["event"] for e in events]
    assert types.count("cell_update") == 8
    assert types.count("done") == 1
    assert max_in_flight <= 4, f"concurrency cap violated: max_in_flight={max_in_flight}"
    # Sanity: at least 4 cells overlap at some point given 8 dispatched + sleeps.
    assert max_in_flight == 4
