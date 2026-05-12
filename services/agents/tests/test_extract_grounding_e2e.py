"""Phase 1.9e — REAL-graph integration test: GroundingGuard enforced via /extract.

Two plans are exercised end-to-end through the live FastAPI ``/agents/km/extract``
SSE handler. The agent graph is built by the real ``build_km_agent`` factory
(real ``GroundingGuard`` middleware, real tool registry, real ``_map_event``
and SSE handler). The ONLY stubbed boundaries are:

  - the LLM (a ``FakeMessagesListChatModel`` that scripts AIMessage tool_calls);
  - outbound KM HTTP (``lib.km_http.km_get`` / ``km_patch``);
  - ``read_paper`` tool's DB-backed coroutine (canned paper slice);
  - persistence (in-memory ``MemorySaver`` / ``InMemoryStore``);
  - ``load_user_config`` (deterministic dict);
  - ``DriveSkillsLoader.load`` (returns ``[]`` — skill loading is orthogonal
    to grounding enforcement, which lives in ``GroundingGuard`` middleware).

Plan A
    The fake model emits ``csv_write_cell`` directly with grounding.paper_id
    set, before any ``read_paper``. ``GroundingGuard.awrap_tool_call``
    intercepts and returns an ``error: forbidden`` ToolMessage. Then the
    fake model returns a no-tool-calls AIMessage to terminate the loop.
    Asserts: SSE emits ``cell_failed`` (not ``cell_update``); ``km_patch``
    never fires (proves the network call was actually short-circuited).

Plan B
    The fake model emits ``read_paper`` first, then ``csv_write_cell`` with
    matching grounding, then a no-tool-calls AIMessage. The guard sees the
    prior read and passes the call through; csv_write_cell invokes
    ``km_patch`` (allow_direct_csv_write=True is set by the /extract route),
    which the test stubs as a successful "ok" PATCH.
    Asserts: SSE emits ``cell_update`` (with the right value+grounding);
    ``km_patch`` was called exactly once.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.language_models.fake_chat_models import (
    FakeMessagesListChatModel,
)
from langchain_core.messages import AIMessage, BaseMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore

SECRET = "test-secret-abc"
os.environ.setdefault("INHALE_INTERNAL_SECRET", SECRET)

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


# ---------------------------------------------------------------------------
# HMAC + SSE helpers (mirror test_extract_route.py)
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
    events: list[dict] = []
    current: str | None = None
    for line in text.splitlines():
        if line.startswith("event: "):
            current = line[len("event: "):]
        elif line.startswith("data: "):
            data = json.loads(line[len("data: "):])
            events.append({"event": current, "data": data})
            current = None
    return events


# ---------------------------------------------------------------------------
# Fake model + scripted-turn helpers
# ---------------------------------------------------------------------------


class _FakeToolCallingModel(FakeMessagesListChatModel):
    """FakeMessagesListChatModel that satisfies the agent's ``bind_tools`` contract.

    The agent factory calls ``model.bind_tools(tools, tool_choice=..., ...)``
    on every model step. The base class inherits ``BaseChatModel.bind_tools``
    which raises ``NotImplementedError`` — we override to return ``self`` so
    the scripted ``responses`` cycle drives the graph.
    """

    def bind_tools(self, tools, **kwargs):  # type: ignore[override]
        return self


def _ai_tool_call(name: str, args: dict, call_id: str) -> AIMessage:
    """Build an AIMessage with a single tool_call matching the agent's schema."""
    return AIMessage(
        content="",
        tool_calls=[{"id": call_id, "name": name, "args": args}],
    )


def _fake_model_with_turns(turns: list[BaseMessage]) -> _FakeToolCallingModel:
    """Build a fake model that emits ``turns[i]`` on the i-th invocation."""
    return _FakeToolCallingModel(responses=list(turns))


# ---------------------------------------------------------------------------
# Paperset fixture + read_paper stub
# ---------------------------------------------------------------------------


_PAPERSET = {
    "file_id": "pset-grounding",
    "columns": [{"name": "n_subjects", "description": "Number of human subjects."}],
    "row_refs": [{"paper_id": "paper-P"}],
    "cells": {},
}

_CELLS = [{"row_idx": 0, "col_name": "n_subjects"}]
_BODY = json.dumps({"paperset_id": "pset-grounding", "cells": _CELLS}).encode()
_HEADERS = _signed_headers("POST", "/agents/km/extract", _BODY)


async def _fake_read_paper(paper_id: str, scope: dict, *, config=None, **_: Any):
    """Canned ``read_paper`` coroutine — bypasses the DB pool + Chandra parse.

    Returns a minimal ``PaperSlice`` shape so the agent's tool runtime
    serializes the result into a ToolMessage the guard can see on the next turn.
    """
    return {
        "paper_id": paper_id,
        "blocks": [
            {
                "block_id": f"{paper_id}:7",
                "text": "Stub block for grounding test.",
                "page": 1,
                "kind": "paragraph",
            }
        ],
        "truncated": False,
        "token_count": 6,
    }


# ---------------------------------------------------------------------------
# Shared patch stack
# ---------------------------------------------------------------------------


def _patch_stack(fake_model, km_patch_mock):
    """Build the patch context manager stack shared by both Plans.

    Stubs ONLY model + KM HTTP + persistence + config + skills-load. The real
    ``build_km_agent`` and ``GroundingGuard`` middleware remain in play.
    """
    from tools.papers import read_paper

    cfg = {
        "modelPreference": "openai/gpt-4o-mini",
        "enabledSkills": ["data-extract"],
        "approvalRules": {},
        "permissions": {},
    }

    return [
        # KM-side paperset metadata fetch (route-level).
        patch(
            "routers.km_agent.km_get",
            new_callable=AsyncMock,
            return_value=_PAPERSET,
        ),
        # User config + model + persistence wiring.
        patch("routers.km_agent.load_user_config", return_value=cfg),
        patch("routers.km_agent.model_for", return_value=fake_model),
        patch("routers.km_agent.get_store", return_value=InMemoryStore()),
        patch("routers.km_agent.get_saver", return_value=MemorySaver()),
        # Personal-skills fetch (km_agent.py `from lib.km_http import km_get`).
        patch(
            "km_agent.km_get",
            new_callable=AsyncMock,
            return_value={"skills": []},
        ),
        # Skill loading is orthogonal to GroundingGuard — bypass the drive
        # round-trip and return an empty allow-list so _filter_tools_for_skills
        # leaves ALL_TOOLS intact (read_paper + csv_write_cell are in core).
        patch(
            "km_agent.DriveSkillsLoader.load",
            new_callable=AsyncMock,
            return_value=[],
        ),
        # csv_write_cell's km_patch call (allow_direct_csv_write=True path).
        # Both the lib module and the tools.data import binding are patched
        # because tools/data.py does `from lib.km_http import km_patch`.
        patch("tools.data.km_patch", km_patch_mock),
        # read_paper's DB-backed coroutine — return canned blocks so the
        # tool runtime emits a ToolMessage the guard's _read_paper_targeted
        # scan can match on the next agent turn.
        patch.object(read_paper, "coroutine", _fake_read_paper),
    ]


def _enter_all(stack):
    return [ctx.__enter__() for ctx in stack]


def _exit_all(stack):
    for ctx in reversed(stack):
        ctx.__exit__(None, None, None)


# ---------------------------------------------------------------------------
# Plan A: csv_write_cell BEFORE read_paper → guard returns error → cell_failed
# ---------------------------------------------------------------------------


def test_extract_plan_a_write_without_read_emits_cell_failed():
    """GroundingGuard blocks csv_write_cell when no prior read_paper exists.

    The real middleware short-circuits the tool call and returns an
    ``error: forbidden`` ToolMessage. The /extract handler's
    ``_extract_filled_payload`` sees the error output (does not start with
    "ok") and emits ``cell_failed``. Critically, ``km_patch`` must NEVER fire.
    """
    write_args = {
        "file_id": "pset-grounding",
        "row": 0,
        "col": "n_subjects",
        "value": "n/a",
        "grounding": {"paper_id": "paper-P", "block_ids": []},
    }
    turns: list[BaseMessage] = [
        _ai_tool_call("csv_write_cell", write_args, "call-write-1"),
        # After the guard's error ToolMessage feeds back into the model, the
        # next AIMessage has no tool_calls → agent loop terminates.
        AIMessage(content="blocked"),
    ]
    fake_model = _fake_model_with_turns(turns)
    km_patch_mock = AsyncMock(return_value={"ok": True})

    stack = _patch_stack(fake_model, km_patch_mock)
    _enter_all(stack)
    try:
        r = client.post("/agents/km/extract", content=_BODY, headers=_HEADERS)
    finally:
        _exit_all(stack)

    assert r.status_code == 200, r.text
    events_out = _parse_sse(r.text)
    types = [e["event"] for e in events_out]

    assert "cell_update" not in types, (
        f"cell_update must not fire when guard blocks write; got {types}"
    )
    assert "cell_failed" in types, (
        f"cell_failed must be emitted when guard returns error; got {types}"
    )

    failed = next(e["data"] for e in events_out if e["event"] == "cell_failed")
    assert failed["row"] == 0
    assert failed["col"] == "n_subjects"

    done = next(e["data"] for e in events_out if e["event"] == "done")
    assert done == {"filled": 0, "failed": 1}

    # The guard short-circuited the tool BEFORE any HTTP went out.
    km_patch_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Plan B: read_paper → csv_write_cell → guard passes → km_patch fires → cell_update
# ---------------------------------------------------------------------------


def test_extract_plan_b_read_then_write_emits_cell_update():
    """GroundingGuard passes through csv_write_cell after a prior read_paper.

    The fake model emits read_paper first; the stubbed coroutine returns a
    canned slice; the tool runtime records a ToolMessage with name="read_paper"
    and the same tool_call_id, which is exactly what
    ``GroundingGuard._read_paper_targeted`` scans for. On the next turn the
    fake model emits csv_write_cell with matching grounding.paper_id; the
    guard's lookup succeeds and the call falls through to the real
    ``csv_write_cell`` tool, which (under ``allow_direct_csv_write=True`` set
    by /extract) invokes ``km_patch``. Final turn ends the loop.
    """
    read_args = {
        "paper_id": "paper-P",
        "scope": {"kind": "sections", "names": ["Methods"]},
    }
    write_args = {
        "file_id": "pset-grounding",
        "row": 0,
        "col": "n_subjects",
        "value": "42",
        "grounding": {"paper_id": "paper-P", "block_ids": ["paper-P:7"]},
    }
    turns: list[BaseMessage] = [
        _ai_tool_call("read_paper", read_args, "call-read-1"),
        _ai_tool_call("csv_write_cell", write_args, "call-write-1"),
        AIMessage(content="done"),
    ]
    fake_model = _fake_model_with_turns(turns)
    km_patch_mock = AsyncMock(return_value={"ok": True})

    stack = _patch_stack(fake_model, km_patch_mock)
    _enter_all(stack)
    try:
        r = client.post("/agents/km/extract", content=_BODY, headers=_HEADERS)
    finally:
        _exit_all(stack)

    assert r.status_code == 200, r.text
    events_out = _parse_sse(r.text)
    types = [e["event"] for e in events_out]

    assert "cell_update" in types, (
        f"cell_update must be emitted on successful write; got {types}"
    )
    assert "cell_failed" not in types, (
        f"cell_failed must not fire when guard passes; got {types}"
    )

    update = next(e["data"] for e in events_out if e["event"] == "cell_update")
    assert update["row"] == 0
    assert update["col"] == "n_subjects"
    assert update["value"] == "42"
    assert update["grounding"]["paper_id"] == "paper-P"

    done = next(e["data"] for e in events_out if e["event"] == "done")
    assert done == {"filled": 1, "failed": 0}

    # The real csv_write_cell tool ran and invoked km_patch exactly once.
    assert km_patch_mock.await_count == 1, (
        f"km_patch must fire once for the direct-write path; got {km_patch_mock.await_count}"
    )
    call_args = km_patch_mock.await_args
    # First positional arg is the path; body kwarg contains row/col/value/grounding.
    path = call_args.args[0] if call_args.args else call_args.kwargs.get("path")
    assert "/api/papersets/pset-grounding/cells" in path
