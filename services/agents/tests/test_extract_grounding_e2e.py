"""Phase 1.9e — REAL-graph integration test: GroundingGuard enforced via /extract."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from contextlib import ExitStack
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


class _FakeToolCallingModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):  # type: ignore[override]
        # Base class raises NotImplementedError; agent factory calls bind_tools
        # every step, so return self to keep the scripted responses cycling.
        return self


def _ai_tool_call(name: str, args: dict, call_id: str) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"id": call_id, "name": name, "args": args}],
    )


def _fake_model_with_turns(turns: list[BaseMessage]) -> _FakeToolCallingModel:
    return _FakeToolCallingModel(responses=list(turns))


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
    # Tool runtime needs a serializable dict so the ToolMessage shows up on the
    # next turn for GroundingGuard._read_paper_targeted to match against.
    return {"paper_id": paper_id, "blocks": [{"block_id": f"{paper_id}:7"}]}


def _patch_stack(fake_model, km_patch_mock):
    from tools.papers import read_paper

    cfg = {
        "modelPreference": "openai/gpt-4o-mini",
        "enabledSkills": ["data-extract"],
        "approvalRules": {},
        "permissions": {},
    }

    return [
        patch(
            "routers.km_agent.km_get",
            new_callable=AsyncMock,
            return_value=_PAPERSET,
        ),
        patch("routers.km_agent.load_user_config", return_value=cfg),
        patch("routers.km_agent.model_for", return_value=fake_model),
        patch("routers.km_agent.get_store", return_value=InMemoryStore()),
        patch("routers.km_agent.get_saver", return_value=MemorySaver()),
        patch(
            "km_agent.km_get",
            new_callable=AsyncMock,
            return_value={"skills": []},
        ),
        # Empty allow-list keeps ALL_TOOLS intact instead of filtering by skill.
        patch(
            "km_agent.DriveSkillsLoader.load",
            new_callable=AsyncMock,
            return_value=[],
        ),
        # tools/data.py does `from lib.km_http import km_patch`, so the bound
        # name in tools.data must be patched (not just the lib module).
        patch("tools.data.km_patch", km_patch_mock),
        # read_paper.coroutine is the DB-backed callable invoked by the tool
        # runtime; stubbing it avoids the pool + Chandra parse.
        patch.object(read_paper, "coroutine", _fake_read_paper),
    ]


def test_extract_plan_a_write_without_read_emits_cell_failed():
    write_args = {
        "file_id": "pset-grounding",
        "row": 0,
        "col": "n_subjects",
        "value": "n/a",
        "grounding": {"paper_id": "paper-P", "block_ids": []},
    }
    turns: list[BaseMessage] = [
        _ai_tool_call("csv_write_cell", write_args, "call-write-1"),
        AIMessage(content="blocked"),
    ]
    fake_model = _fake_model_with_turns(turns)
    km_patch_mock = AsyncMock(return_value={"ok": True})

    with ExitStack() as stack:
        for ctx in _patch_stack(fake_model, km_patch_mock):
            stack.enter_context(ctx)
        r = client.post("/agents/km/extract", content=_BODY, headers=_HEADERS)

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

    km_patch_mock.assert_not_called()


def test_extract_plan_b_read_then_write_emits_cell_update():
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

    with ExitStack() as stack:
        for ctx in _patch_stack(fake_model, km_patch_mock):
            stack.enter_context(ctx)
        r = client.post("/agents/km/extract", content=_BODY, headers=_HEADERS)

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

    assert km_patch_mock.await_count == 1, (
        f"km_patch must fire once for the direct-write path; got {km_patch_mock.await_count}"
    )
    call_args = km_patch_mock.await_args
    path = call_args.args[0] if call_args.args else call_args.kwargs.get("path")
    assert "/api/papersets/pset-grounding/cells" in path
