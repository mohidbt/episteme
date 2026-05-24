"""Live E2E for reader-side-panel agent tool surface.

Runs against the real /agents/km/invoke endpoint with HMAC-signed requests.
Skips cleanly when the local stack isn't running or required env is missing.

Prerequisites:
    - Agent service running on :8000  (uv run uvicorn app:app --port 8000)
    - INHALE_INTERNAL_SECRET set
    - OPENROUTER_KEY set

Run:
    INHALE_INTERNAL_SECRET=... OPENROUTER_KEY=... \
        uv run pytest tests/test_reader_agent_e2e.py -v -s
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid

import httpx
import pytest

USER_ID = "XrC7P8lmROSz03yk8hcwR9VNWXkFjjJL"
PAPER_ID = "03b26461-50e0-4052-839b-d2ffd233e315"
BASE = os.environ.get("EPISTEME_AGENTS_BASE_URL", "http://localhost:8000")


def _service_up() -> bool:
    try:
        with httpx.Client(timeout=2.0) as c:
            r = c.post(f"{BASE}/agents/km/invoke", json={})
            return r.status_code in (400, 401, 422)
    except Exception:
        return False


@pytest.fixture(scope="module")
def env_guard():
    if not os.environ.get("INHALE_INTERNAL_SECRET"):
        pytest.skip("INHALE_INTERNAL_SECRET not set — required to sign HMAC requests")
    if not os.environ.get("OPENROUTER_KEY"):
        pytest.skip("OPENROUTER_KEY not set — required for live model calls")
    if not _service_up():
        pytest.skip(f"agent service not reachable at {BASE} — start with `uv run uvicorn app:app --port 8000`")


def _sign(method: str, path: str, body: str) -> dict[str, str]:
    secret = os.environ["INHALE_INTERNAL_SECRET"]
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), (ts + method + path + body).encode(), hashlib.sha256).hexdigest()
    llm = os.environ["OPENROUTER_KEY"]
    return {
        "X-Inhale-User-Id": USER_ID,
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "X-Inhale-LLM-Key": llm,
        "X-Inhale-OCR-Key": llm,
        "Content-Type": "application/json",
    }


def _invoke(message, *, page_context=None, enabled_skills=None):
    """Returns (tool_calls, text, interrupts, errors, tool_ends)."""
    body_obj = {"thread_id": str(uuid.uuid4()), "message": message}
    if page_context:
        body_obj["page_context"] = page_context
    if enabled_skills is not None:
        body_obj["enabled_skills"] = enabled_skills
    body = json.dumps(body_obj)
    path = "/agents/km/invoke"

    tool_calls: list[str] = []
    tool_ends: list[dict] = []
    text_chunks: list[str] = []
    interrupts: list[dict] = []
    errors: list[dict] = []

    with httpx.Client(timeout=180.0) as c:
        with c.stream("POST", BASE + path, content=body, headers=_sign("POST", path, body)) as r:
            assert r.status_code == 200, f"http {r.status_code}: {r.read().decode()[:300]}"
            current = None
            for line in r.iter_lines():
                if not line:
                    continue
                if line.startswith("event:"):
                    current = line[6:].strip()
                    continue
                if line.startswith("data:"):
                    raw = line[5:].strip()
                    try:
                        data = json.loads(raw)
                    except Exception:
                        data = {"raw": raw}
                    if current == "tool_call":
                        tool_calls.append(data.get("name", "?"))
                    elif current == "tool_end":
                        tool_ends.append(data)
                    elif current == "text":
                        d = data.get("delta") or data.get("text") or ""
                        if isinstance(d, str):
                            text_chunks.append(d)
                    elif current in ("interrupt", "tool_interrupt", "human_input"):
                        interrupts.append(data)
                    elif current in ("error", "stream_error"):
                        errors.append(data)
    return tool_calls, "".join(text_chunks), interrupts, errors, tool_ends


def _no_tool_errors(tool_ends: list[dict]) -> bool:
    for e in tool_ends:
        result = e.get("result") or e.get("output") or {}
        if isinstance(result, dict) and result.get("error"):
            return False
        if isinstance(result, str) and result.lower().startswith("error"):
            return False
    return True


# ---------- tests ----------

def test_list_pdfs(env_guard):
    tools, text, _, errs, _ = _invoke("List all the papers in my library. Use list_pdfs.")
    assert "list_pdfs" in tools, f"tools={tools}"
    assert any(s in text for s in ("test_real_paper", "Propensity", "Retrieval-Augmented")), f"text={text[:400]!r}"
    assert not errs, f"errs={errs[:1]}"


def test_search_pdfs(env_guard):
    tools, text, _, errs, _ = _invoke(
        "Search my papers for one with 'protein signalling' in the title. Use search_pdfs."
    )
    assert "search_pdfs" in tools, f"tools={tools}"
    assert "Spontaneous switching" in text, f"text={text[:400]!r}"
    assert not errs, f"errs={errs[:1]}"


def test_read_paper_with_page_context(env_guard):
    tools, text, _, errs, ends = _invoke(
        "Read the current paper fully. Use read_paper with scope full.",
        page_context={"paperId": PAPER_ID},
    )
    assert "read_paper" in tools, f"tools={tools}"
    assert text.strip(), "expected non-empty model text"
    assert _no_tool_errors(ends), f"tool errors in ends={ends[:1]}"
    assert not errs, f"errs={errs[:1]}"


def test_pdf_explain_passage(env_guard):
    tools, text, _, errs, _ = _invoke(
        "Explain this passage from page 1 of the current paper: 'spontaneous switching'. "
        "Use pdf_explain_passage.",
        page_context={"paperId": PAPER_ID},
    )
    assert "pdf_explain_passage" in tools, f"tools={tools}"
    assert "switching" in text.lower(), f"text={text[:400]!r}"
    assert not errs, f"errs={errs[:1]}"


def test_search_library(env_guard):
    tools, _text, _ints, errs, _ends = _invoke(
        "Use the search_library tool with query='retrieval augmented generation' to do RAG "
        "over my whole library. Do not use search_notes or search_pdfs first.",
        enabled_skills=["deep-read"],
    )
    assert "search_library" in tools, f"tools={tools}"
    assert not errs, f"errs={errs[:1]}"


def test_highlight_hits_hitl_interrupt(env_guard):
    tools, text, interrupts, _errs, _ends = _invoke(
        f"Highlight page 1 of paper {PAPER_ID} with note 'check'. Use highlight.",
        page_context={"paperId": PAPER_ID},
        enabled_skills=["deep-read"],
    )
    # HITL surface: either an interrupt event with tool=highlight, or interrupt payload
    # appears embedded in the SSE text — handle both.
    found = any(
        (isinstance(p, dict) and (p.get("tool") == "highlight" or
                                  (isinstance(p.get("value"), dict) and p["value"].get("tool") == "highlight")))
        for p in interrupts
    )
    if not found:
        # fall back to scanning raw payloads / text for the tool name
        joined = json.dumps(interrupts) + text
        found = '"tool": "highlight"' in joined or '"tool":"highlight"' in joined
    assert found, f"expected highlight HITL interrupt; tools={tools} interrupts={interrupts[:1]} text={text[:200]!r}"


def test_reader_context_paperId_propagates(env_guard):
    _tools, text, _, errs, _ = _invoke(
        "Which paper am I looking at right now?",
        page_context={"paperId": PAPER_ID},
    )
    tail = PAPER_ID[-8:]
    assert (tail in text) or ("paper_id" in text.lower()) or (PAPER_ID in text), (
        f"expected paperId propagation; text={text[:400]!r}"
    )
    assert not errs, f"errs={errs[:1]}"
