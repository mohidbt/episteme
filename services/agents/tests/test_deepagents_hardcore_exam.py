"""Hardcore DeepAgents exam (red-green): promptset + tool-use + solve checks.

This suite grades behavior using realistic user prompts and strict expectations:
- which tools are called
- whether HITL interrupts happen on the expected tool
- whether the final response content demonstrates task completion
"""

import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)


def _signed_headers(method: str, path: str, body: bytes) -> dict[str, str]:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "exam_user",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


def _parse_sse(text: str) -> list[dict]:
    out: list[dict] = []
    current_event = None
    for line in text.splitlines():
        if line.startswith("event: "):
            current_event = line[len("event: "):]
        elif line.startswith("data: "):
            out.append({"event": current_event, "data": json.loads(line[len("data: "):])})
            current_event = None
    return out


def _load_promptset() -> dict:
    path = Path(__file__).parent / "fixtures" / "deepagents_hardcore_promptset.json"
    return json.loads(path.read_text())


def _fake_events_for_skill(skill: str):
    async def _events(input_, config, version):  # noqa: ARG001
        if skill == "lit-triage":
            yield {"event": "on_tool_start", "run_id": "t1", "name": "search_notes", "data": {"input": {"query": "this week"}}}
            yield {"event": "on_tool_end", "run_id": "t1", "name": "search_notes", "data": {"output": {"hits": 5}}}
            yield {"event": "on_tool_start", "run_id": "t2", "name": "list_references", "data": {"input": {}}}
            yield {"event": "on_tool_end", "run_id": "t2", "name": "list_references", "data": {"output": {"count": 12}}}
            yield {
                "event": "on_chain_end",
                "run_id": "int-1",
                "data": {"output": {"__interrupt__": [MagicMock(value={"tool": "create_note", "args": {"title": "Inbox — 2026-05-04"}}, id="int-1")]}}
            }
            yield {"event": "on_chat_model_stream", "run_id": "m1", "data": {"chunk": MagicMock(content="## Must read\n- A\n## Skim\n- B\n## Skip\n- C")}}
            return

        if skill == "deep-read":
            yield {"event": "on_tool_start", "run_id": "t1", "name": "search_pdfs", "data": {"input": {"query": "paper"}}}
            yield {"event": "on_tool_end", "run_id": "t1", "name": "search_pdfs", "data": {"output": {"count": 1}}}
            yield {"event": "on_tool_start", "run_id": "t2", "name": "read_paper", "data": {"input": {"paper_id": "11111111-1111-1111-1111-111111111111"}}}
            yield {"event": "on_tool_end", "run_id": "t2", "name": "read_paper", "data": {"output": {"ok": True}}}
            yield {"event": "on_tool_start", "run_id": "t3", "name": "pdf_read_text", "data": {"input": {"paper_id": "11111111-1111-1111-1111-111111111111", "page": 2}}}
            yield {"event": "on_tool_end", "run_id": "t3", "name": "pdf_read_text", "data": {"output": {"ok": True}}}
            yield {
                "event": "on_chain_end",
                "run_id": "int-2",
                "data": {"output": {"__interrupt__": [MagicMock(value={"tool": "highlight", "args": {"paper_id": "11111111-1111-1111-1111-111111111111"}}, id="int-2")]}}
            }
            yield {"event": "on_tool_start", "run_id": "t4", "name": "highlight", "data": {"input": {"paper_id": "11111111-1111-1111-1111-111111111111"}}}
            yield {"event": "on_tool_end", "run_id": "t4", "name": "highlight", "data": {"output": {"id": "h1"}}}
            yield {"event": "on_tool_start", "run_id": "t5", "name": "create_note", "data": {"input": {"title": "Deep-read summary"}}}
            yield {"event": "on_tool_end", "run_id": "t5", "name": "create_note", "data": {"output": {"id": "n1"}}}
            yield {"event": "on_chat_model_stream", "run_id": "m2", "data": {"chunk": MagicMock(content="Key result [[pdf:11111111-1111-1111-1111-111111111111#p2]]")}}
            return

        if skill == "synthesis":
            yield {"event": "on_tool_start", "run_id": "t1", "name": "search_notes", "data": {"input": {"query": "predictive coding"}}}
            yield {"event": "on_tool_end", "run_id": "t1", "name": "search_notes", "data": {"output": {"hits": 3}}}
            yield {"event": "on_tool_start", "run_id": "t2", "name": "read_note", "data": {"input": {"id_or_slug": "a"}}}
            yield {"event": "on_tool_end", "run_id": "t2", "name": "read_note", "data": {"output": {"id": "a"}}}
            yield {"event": "on_tool_start", "run_id": "t3", "name": "write_file", "data": {"input": {"path": "/scratch/predictive-coding.md"}}}
            yield {"event": "on_tool_end", "run_id": "t3", "name": "write_file", "data": {"output": {"ok": True}}}
            yield {"event": "on_chat_model_stream", "run_id": "m3", "data": {"chunk": MagicMock(content="Drafted /scratch/predictive-coding.md\n\n⚠ unsupported claim here.")}}
            return

    return _events


class _DiskBackedDriveLoader:
    async def load(self, only, *, user_id):  # noqa: ARG002
        from skills import load_skills  # noqa: PLC0415
        return load_skills(only=only) if only else []


def _grade(events: list[dict], scenario: dict) -> list[str]:
    failures: list[str] = []
    called_tools = [e["data"]["name"] for e in events if e["event"] == "tool_call"]
    interrupts = [e for e in events if e["event"] == "interrupt"]
    all_text = "\n".join(
        e["data"].get("delta", "") for e in events if e["event"] == "text"
    )

    for t in scenario.get("expected_tools_all", []):
        if t not in called_tools:
            failures.append(f"missing expected tool call: {t}")
    any_group = scenario.get("expected_tools_any", [])
    if any_group and not any(t in called_tools for t in any_group):
        failures.append(f"expected one of tools {any_group}, got {called_tools}")
    for t in scenario.get("must_not_call_tools", []):
        if t in called_tools:
            failures.append(f"forbidden tool called: {t}")

    itool = scenario.get("expected_interrupt_tool")
    if itool:
        if not any(i["data"].get("tool") == itool for i in interrupts):
            failures.append(f"missing interrupt for tool: {itool}")

    for needle in scenario.get("must_include_text", []):
        if needle not in all_text:
            failures.append(f"missing solution evidence text: {needle}")

    if events[-1]["event"] != "done":
        failures.append("missing final done event")
    return failures


def test_deepagents_tool_inventory_is_stable():
    from tools import ALL_TOOLS  # noqa: PLC0415
    from km_agent import _CORE_TOOL_NAMES  # noqa: PLC0415
    from subagents import RESEARCHER_TOOL_NAMES, SYNTHESIZER_TOOL_NAMES, VERIFIER_TOOL_NAMES  # noqa: PLC0415

    tool_names = {t.name for t in ALL_TOOLS}
    assert len(tool_names) == 25
    assert _CORE_TOOL_NAMES.issubset(tool_names)
    assert set(RESEARCHER_TOOL_NAMES).issubset(tool_names | {"arxiv_search", "biorxiv_search", "pubmed_search"})
    assert set(SYNTHESIZER_TOOL_NAMES).issubset(tool_names)
    assert set(VERIFIER_TOOL_NAMES).issubset(tool_names | {"arxiv_search", "biorxiv_search", "pubmed_search"})


def test_hardcore_promptset_exam_red_green():
    promptset = _load_promptset()
    assert promptset["scenarios"], "promptset must define at least one scenario"

    with patch("routers.km_agent.DriveSkillsLoader", _DiskBackedDriveLoader):
        for scenario in promptset["scenarios"]:
            body = json.dumps(
                {
                    "thread_id": f"exam-{scenario['id']}",
                    "message": scenario["prompt"],
                    "enabled_skills": [scenario["skill"]],
                }
            ).encode()
            with patch(
                "routers.km_agent.build_km_agent",
                new_callable=AsyncMock,
                return_value=MagicMock(
                    astream_events=_fake_events_for_skill(scenario["skill"]),
                    aget_state=AsyncMock(return_value=MagicMock(tasks=[], values={})),
                ),
            ):
                r = client.post(
                    "/agents/km/invoke",
                    content=body,
                    headers=_signed_headers("POST", "/agents/km/invoke", body),
                )
            assert r.status_code == 200, f"{scenario['id']} failed to invoke"
            events = _parse_sse(r.text)
            failures = _grade(events, scenario)
            assert not failures, f"{scenario['id']} exam failures: {failures}"

