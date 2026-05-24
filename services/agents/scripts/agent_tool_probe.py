#!/usr/bin/env python3
"""Probe agent API for each tool. RED-GREEN per tool.

Signs HMAC requests against the locally running agent service at :8000
(same scheme used by apps/km/src/lib/agents/sign-request.ts).

Usage:
    python3 agent_probe.py [tool1 tool2 ...]
    python3 agent_probe.py            # run all
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
import uuid
from typing import Any

import httpx

USER_ID = "XrC7P8lmROSz03yk8hcwR9VNWXkFjjJL"  # test@mohid.de
PAPER_ID = "03b26461-50e0-4052-839b-d2ffd233e315"  # test_real_paper.pdf
RAG_PAPER_ID = "964203ca-6d93-4369-a77a-521fae178863"  # RAG paper
SECRET = os.environ.get("INHALE_INTERNAL_SECRET", "dev-secret-for-hmac-signing-not-for-production")
LLM_KEY = os.environ.get("OPENROUTER_KEY", "sk-or-v1-REDACTED")
BASE = "http://localhost:8000"


def sign(method: str, path: str, body: str) -> dict[str, str]:
    ts = str(int(time.time()))
    msg = (ts + method + path + body).encode()
    sig = hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()
    return {
        "X-Inhale-User-Id": USER_ID,
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "X-Inhale-LLM-Key": LLM_KEY,
        "X-Inhale-OCR-Key": LLM_KEY,
        "Content-Type": "application/json",
    }


def invoke(message: str, *, page_context: dict | None = None, enabled_skills: list[str] | None = None, model_preference: str | None = None) -> tuple[list[str], list[dict], str]:
    """POST /agents/km/invoke and parse SSE stream.

    Returns (tool_call_names, tool_end_payloads, full_text_summary).
    """
    thread_id = str(uuid.uuid4())
    body_obj: dict[str, Any] = {"thread_id": thread_id, "message": message}
    if page_context:
        body_obj["page_context"] = page_context
    if enabled_skills is not None:
        body_obj["enabled_skills"] = enabled_skills
    if model_preference:
        body_obj["model_preference"] = model_preference
    body = json.dumps(body_obj)

    path = "/agents/km/invoke"
    headers = sign("POST", path, body)

    tool_calls: list[str] = []
    tool_ends: list[dict] = []
    text_chunks: list[str] = []
    errors: list[str] = []
    interrupted: list[dict] = []

    with httpx.Client(timeout=120.0) as client:
        with client.stream("POST", BASE + path, content=body, headers=headers) as resp:
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.read().decode()[:500]}")
            current_event = None
            event_kinds: list[str] = []
            for line in resp.iter_lines():
                if not line:
                    continue
                if line.startswith("event:"):
                    event_kinds.append(line[6:].strip())
                    current_event = line[6:].strip()
                    continue
                if line.startswith("data:"):
                    payload = line[5:].strip()
                    try:
                        data = json.loads(payload)
                    except Exception:
                        data = {"raw": payload}
                    if current_event == "tool_call":
                        tool_calls.append(data.get("name", "<unknown>"))
                    elif current_event == "tool_end":
                        tool_ends.append(data)
                    elif current_event == "text":
                        chunk = data.get("delta") or data.get("text") or ""
                        if isinstance(chunk, str):
                            text_chunks.append(chunk)
                    elif current_event in ("error", "stream_error"):
                        errors.append(payload)
                    elif current_event in ("interrupt", "tool_interrupt", "human_input"):
                        interrupted.append(data)
    summary = "".join(text_chunks)[:600]
    if errors:
        summary += "\n[ERRORS] " + "; ".join(errors[:3])
    if interrupted:
        summary += "\n[INTERRUPT] " + json.dumps(interrupted[0])[:300]
    summary += f"\n[event_kinds={event_kinds[:30]}]"
    return tool_calls, tool_ends, summary


# (label, prompt, expected_tool, opts)
PROBES: list[tuple[str, str, str, dict]] = [
    ("list_pdfs",        "List all the papers in my library. Use list_pdfs.",                                                          "list_pdfs",          {}),
    ("search_pdfs",      "Search my papers for one with 'finite-size scaling' or 'protein signalling' in the title. Use search_pdfs.", "search_pdfs",        {}),
    ("read_paper",       f"Read paper {PAPER_ID} fully. Use read_paper with scope full.",                                              "read_paper",         {"page_context": {"paperId": PAPER_ID}}),
    ("pdf_explain_passage", f"Explain this passage from paper {PAPER_ID} on page 1: 'spontaneous switching'. Use pdf_explain_passage.", "pdf_explain_passage", {"page_context": {"paperId": PAPER_ID}}),
    ("list_libraries",   "List my libraries. Use list_libraries.",                                                                     "list_libraries",     {}),
    ("list_notes",       "List my notes. Use list_notes.",                                                                             "list_notes",         {}),
    ("search_notes",     "Search my notes for 'phase transition'. Use search_notes.",                                                   "search_notes",       {}),
    ("list_references",  "List references in my default library. Use list_references.",                                               "list_references",    {}),
    ("browse_papersets", "List my papersets. Use browse_papersets.",                                                                   "browse_papersets",   {}),
    ("search_library",   "Use the search_library tool with query='phase transitions' to do RAG over my whole library. Do not use search_notes or search_pdfs first.", "search_library", {"enabled_skills": ["deep-read"]}),
    ("highlight",        f"Highlight page 1 of paper {PAPER_ID} with note 'check'. Use highlight.",                                    "highlight",          {"page_context": {"paperId": PAPER_ID}, "enabled_skills": ["deep-read"]}),
]


def main() -> int:
    only = set(sys.argv[1:])
    pass_count = 0
    fail_count = 0
    results: list[tuple[str, str, str]] = []  # (label, status, detail)
    for label, prompt, expected, opts in PROBES:
        if only and label not in only:
            continue
        print(f"\n=== {label} ===", flush=True)
        try:
            tools, ends, text = invoke(prompt, **opts)
            in_interrupt = f'"tool": "{expected}"' in text  # interrupt payload includes tool name
            tool_fired = (expected in tools) or in_interrupt
            # Tool-end errors for the expected tool count as RED — fired but
            # downstream returned an error (schema rejection, ocr_key missing,
            # 4xx/5xx from KM, etc.). HITL interrupts are not tool_end errors.
            expected_errors = [
                e for e in ends
                if e.get("name") == expected and (
                    e.get("error") is True
                    or (isinstance(e.get("output"), dict) and e["output"].get("error") is True)
                    or (isinstance(e.get("output"), str) and "Error" in e["output"][:100])
                )
            ]
            stream_errors = [e for e in (text.split("[ERRORS]")[1:2]) if e.strip()]
            tool_ok = tool_fired and not expected_errors and not stream_errors
            ok = tool_ok
            status = "GREEN" if ok else "RED"
            detail = f"tools={tools[:5]} text={text[:200]!r}"
            if expected_errors:
                detail += f" tool_end_errors={len(expected_errors)}"
            if stream_errors:
                detail += " stream_error=yes"
            print(f"[{status}] {label}  expected={expected}  {detail}", flush=True)
            if ok:
                pass_count += 1
            else:
                fail_count += 1
            results.append((label, status, detail))
        except Exception as e:
            fail_count += 1
            print(f"[RED] {label}  EXC: {e}", flush=True)
            results.append((label, "RED", f"exception: {e}"))

    print(f"\n--- summary ---  GREEN={pass_count}  RED={fail_count}")
    for label, status, _ in results:
        print(f"  {status}  {label}")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
