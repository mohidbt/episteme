"""End-to-end tests for every agent tool via the SSE invoke API.

Runs against a live agent service on :8000 with HMAC auth.
Requires: INHALE_INTERNAL_SECRET, TEST_USER_ID, ENCRYPTION_KEY, and a running
           agent service + postgres + KM dev server.

Marked @pytest.mark.integration — skipped by default (`pytest -m integration`).
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import time
import uuid

import httpx
import pytest

# ---------------------------------------------------------------------------
# Config — all from env vars, no hardcoded secrets
# ---------------------------------------------------------------------------
AGENTS_URL = os.getenv("AGENTS_URL", "http://localhost:8000")
SECRET = os.getenv("INHALE_INTERNAL_SECRET")
USER_ID = os.getenv("TEST_USER_ID")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
MODEL = os.getenv("TEST_MODEL", "openai/gpt-5.4-nano")

pytestmark = pytest.mark.integration

# Skip entire module if any required env var is missing
_missing = [k for k, v in [("INHALE_INTERNAL_SECRET", SECRET), ("TEST_USER_ID", USER_ID), ("ENCRYPTION_KEY", ENCRYPTION_KEY)] if not v]
if _missing:
    pytest.skip(f"Missing env vars: {', '.join(_missing)} — set them to run E2E tool tests", allow_module_level=True)


# ---------------------------------------------------------------------------
# HMAC + BYOK key helpers
# ---------------------------------------------------------------------------
def _decrypt_key(encrypted_b64: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    padded = encrypted_b64 + "=" * (-len(encrypted_b64) % 4)
    raw = base64.urlsafe_b64decode(padded)
    key = bytes.fromhex(ENCRYPTION_KEY)
    iv, auth_tag, ciphertext = raw[:12], raw[12:28], raw[28:]
    return AESGCM(key).decrypt(iv, ciphertext + auth_tag, None).decode()


def _sign(ts: str, method: str, path: str, body: bytes = b"") -> str:
    msg = ts.encode() + method.encode() + path.encode() + body
    return hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()


def _headers(method: str, path: str, body: bytes = b"") -> dict:
    ts = str(int(time.time()))
    return {
        "X-Inhale-User-Id": USER_ID,
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": _sign(ts, method, path, body),
        "X-Inhale-LLM-Key": _decrypt_key(
            os.getenv("TEST_ENCRYPTED_KEY", "")
            or _fetch_encrypted_key(),
        ),
        "Content-Type": "application/json",
    }


def _fetch_encrypted_key() -> str:
    """Read encrypted LLM key from the DB if not provided via env."""
    import psycopg2

    url = os.getenv("DATABASE_URL", "postgresql://episteme:episteme@localhost:5433/episteme")
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT encrypted_key FROM user_api_keys WHERE user_id = %s AND provider_type = 'llm' LIMIT 1",
                (USER_ID,),
            )
            row = cur.fetchone()
            return row[0] if row else ""
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# SSE invoke helper
# ---------------------------------------------------------------------------
async def _invoke(thread_id: str, message: str, skills: list[str] | None = None) -> list[tuple[str, dict]]:
    path = "/agents/km/invoke"
    payload: dict = {"thread_id": thread_id, "message": message, "model_preference": MODEL}
    if skills is not None:
        payload["enabled_skills"] = skills
    body = json.dumps(payload).encode()
    hdrs = _headers("POST", path, body)

    all_events: list[tuple[str, dict]] = []
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", f"{AGENTS_URL}{path}", headers=hdrs, content=body) as resp:
            if resp.status_code != 200:
                err = await resp.aread()
                return [("error", {"status": resp.status_code, "body": err.decode()[:500]})]

            buf, ev_type = "", None
            async for chunk in resp.aiter_text():
                buf += chunk
                while "\n\n" in buf:
                    frame, buf = buf.split("\n\n", 1)
                    for line in frame.splitlines():
                        if line.startswith("event:"):
                            ev_type = line.split(":", 1)[1].strip()
                        elif line.startswith("data:"):
                            try:
                                parsed = json.loads(line.split(":", 1)[1].strip())
                            except json.JSONDecodeError:
                                parsed = {"raw": line}
                            if ev_type:
                                all_events.append((ev_type, parsed))
                                ev_type = None
    return all_events


def _extract_traces(events: list[tuple[str, dict]]) -> dict[str, dict]:
    """Map tool name → {args, state, output, error}."""
    call_by_id: dict[str, dict] = {}
    results: dict[str, dict] = {}
    for ev_type, data in events:
        if ev_type == "tool_call":
            call_by_id[data["id"]] = {"name": data["name"], "args": data.get("args", {})}
        elif ev_type == "tool_result":
            tc_id = data.get("id")
            if tc_id in call_by_id:
                name = call_by_id[tc_id]["name"]
                results[name] = {
                    "args": call_by_id[tc_id]["args"],
                    "state": data.get("state"),
                    "output": data.get("output"),
                    "error": data.get("errorText"),
                }
        elif ev_type == "interrupt":
            results[data.get("tool", "?")] = {
                "args": data.get("args"),
                "state": "interrupt",
                "output": None,
                "error": None,
            }
    return results


# ---------------------------------------------------------------------------
# Test cases — (tool_name, prompt, skills_override)
# ---------------------------------------------------------------------------
CASES: list[tuple[str, str, list[str] | None]] = [
    ("list_notes", "List all my notes. Use the list_notes tool.", None),
    ("search_notes", "Search my notes for 'test'. Use search_notes.", None),
    ("list_folders", "List all my folders. Use list_folders.", None),
    ("list_libraries", "List all my libraries. Use list_libraries.", None),
    ("list_references", "List references in my first library. Use list_libraries then list_references.", None),
    ("get_reference", "Get details of the first reference. Use list_libraries, list_references, then get_reference.", None),
    ("list_pdfs", "List all my PDFs. Use list_pdfs.", None),
    ("search_pdfs", "Search my PDFs for 'test'. Use search_pdfs.", None),
    ("list_links", "Show outgoing links from a note. Use list_notes then list_links.", None),
    ("list_backlinks", "Show backlinks for a note. Use list_notes then list_backlinks.", None),
    ("read_note", "Read the first note. Use list_notes then read_note.", None),
    ("create_note", "Create note titled 'E2E Test Note' with content 'Created by E2E test.'", None),
    ("update_note", "Update the note 'E2E Test Note' — set content to 'Updated by E2E.' Use search_notes, read_note, then update_note.", None),
    ("make_public", "Make the note 'E2E Test Note' public. Use list_notes then make_public.", None),
    # Paper search — requires paper-search skill enabled
    ("agentic_search_papers", "Search for a paper PDF for the first reference in my library. Use list_references to get a reference ID, then agentic_search_papers to find candidate papers.", ["paper-search"]),
]


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("tool,prompt,skills", CASES, ids=[c[0] for c in CASES])
async def test_tool_invoked_and_returns_data(tool: str, prompt: str, skills: list[str] | None):
    thread_id = str(uuid.uuid4())
    events = await _invoke(thread_id, prompt, skills)

    # No stream-level errors
    stream_errors = [(t, d) for t, d in events if t == "error"]
    assert not stream_errors, f"Stream error: {stream_errors[0][1]}"

    traces = _extract_traces(events)
    assert tool in traces, f"Expected tool '{tool}' not called. Called: {list(traces.keys())}"

    trace = traces[tool]
    assert trace["state"] != "output-error", f"Tool error: {trace.get('error', '')[:300]}"

    # For approval-gated tools, HITL interrupt is the expected success path
    if trace["state"] == "interrupt":
        assert tool in ("make_public", "agentic_fetch_papers"), f"Unexpected HITL interrupt for {tool}"
        return

    output = trace["output"]
    assert output is not None, f"No output for {tool}"

    # Type-specific assertions
    if tool in ("list_notes", "list_libraries", "list_pdfs", "list_references", "list_links"):
        assert isinstance(output, (list, dict)), f"{tool} returned non-collection: {type(output)}"
    elif tool in ("search_notes", "search_pdfs"):
        assert isinstance(output, dict) and "results" in output, f"{tool} missing 'results' key"
    elif tool in ("read_note", "create_note", "update_note", "get_reference"):
        assert isinstance(output, dict) and "id" in output, f"{tool} missing 'id' in output"
    elif tool == "list_folders":
        assert isinstance(output, dict) and "folders" in output, f"list_folders missing 'folders' key"
    elif tool == "agentic_search_papers":
        assert isinstance(output, dict) and "found" in output, f"agentic_search_papers missing 'found' key"