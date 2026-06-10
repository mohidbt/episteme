"""GSD-70 — natural-language E2E that every shipped tool is reachable.

Runs against a live KM (default ``https://tryepisteme.com``, override via
``KM_E2E_URL``) using the test account ``test@mohid.de``. Authenticates via
better-auth, then posts natural-language prompts to ``/api/agents/km/invoke``
and asserts the streamed tool-call inventory contains the expected tool name.

The point: the agent's tool selection from natural language is what real
users get, not direct tool-API hits. A tool can be in ``ALL_TOOLS`` yet
never picked from a plain English prompt — those are the bugs this catches.

Gated on ``RUN_LIVE_E2E=1`` so CI does not call out by default. Heavy by
design: each scenario spends LLM tokens + waits on real SSE.

Run:
    RUN_LIVE_E2E=1 KM_E2E_URL=https://preview.tryepisteme.com \\
        uv run pytest tests/test_tool_inventory_e2e.py -v
"""
from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("RUN_LIVE_E2E"),
    reason="Live E2E disabled (set RUN_LIVE_E2E=1 to run against KM_E2E_URL).",
)


_KM_URL = os.getenv("KM_E2E_URL", "https://tryepisteme.com").rstrip("/")
_USER = "test@mohid.de"
_PASS = "Testest2026"


@dataclass(frozen=True)
class Scenario:
    """One natural-language prompt and the tool it should select."""

    tool: str
    prompt: str
    xfail_reason: str | None = None
    page_context: dict | None = None


# Verbatim prompts — readability matters; these are what a human would type.
# Mark known-broken tools as xfail with a concrete reason, NOT skip — xfail
# surfaces the gap on every run.
_GSD55_PENDING = "GSD-55 citation routes pending dual-auth migration follow-up"
_DESTRUCTIVE = "destructive — would mutate prod data; run only in scratch tenant"

SCENARIOS: list[Scenario] = [
    # discovery / read-only
    Scenario("list_notes", "List my notes."),
    Scenario("search_notes", "Find my notes that mention transformers."),
    Scenario("read_note", "Read my welcome note."),
    Scenario("list_links", "What does my welcome note link to?"),
    Scenario("list_backlinks", "What links into my welcome note?"),
    Scenario("list_references", "Show my bibliography."),
    Scenario("get_reference", "What's the reference for Vaswani 2017?"),
    Scenario("list_libraries", "What libraries do I have?"),
    Scenario("list_folders", "Show my folders."),
    Scenario("find_papers", "Find that 'attention is all you need' PDF."),
    Scenario("agentic_search_papers", "Find a PDF for that DOI online."),
    Scenario("search_papers_online", "Search arXiv for diffusion model survey."),
    Scenario("browse_papersets", "What papersets do I have?"),
    Scenario("csv_read", "Read row 3 of my Literature paperset."),
    Scenario("web_search", "What's new in AI today?"),
    Scenario("search_library", "Search my library for transformers."),
    # GSD-70 new CORE tools — read-only
    Scenario("list_user_highlights", "What's up with my highlights?"),
    Scenario("fill_reference", "Fill in the missing fields for that reference."),
    Scenario("resolve_doi", "What's this DOI about: 10.1038/nature12373?"),
    Scenario("pdf_read_tables", "Pull out the tables from this paper."),
    Scenario("diff_revision",
             "What changed between the last two revisions of my welcome note?"),
    Scenario("list_revisions", "What changed in my welcome note?"),
    # Reader-context-bound (need page_context)
    Scenario("read_paper", "Read this paper for me.",
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("pdf_explain_passage", "Explain this passage from the paper.",
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    # Approval-gated — xfail (interrupt event instead of tool result)
    Scenario("create_note", "Make a new note titled 'scratch'.",
             xfail_reason="write_note default require → HITL interrupt"),
    Scenario("update_note", "Edit my scratch note to add 'hello'.",
             xfail_reason="update_note default require → HITL interrupt"),
    Scenario("highlight", "Highlight that paragraph.",
             xfail_reason="highlight default require → HITL interrupt"),
    Scenario("agentic_fetch_papers", "Download the top result.",
             xfail_reason="agentic_fetch_papers default require → HITL interrupt"),
    Scenario("csv_write_cell", "Fill in the abstract column for row 3.",
             xfail_reason="write to paperset — likely HITL interrupt"),
    Scenario("paperset_enrich", "Fill in the missing cells in my Literature paperset.",
             xfail_reason="paperset_enrich default require → HITL interrupt"),
    Scenario("make_public", "Publish my welcome note.",
             xfail_reason="make_public default require → HITL interrupt"),
    # Destructive — xfail (would mutate prod data)
    Scenario("delete_user_highlight",
             "Delete the highlight I made about transformers.",
             xfail_reason=_DESTRUCTIVE),
    Scenario("move_paper", "Move that PDF to my Inbox folder.",
             xfail_reason=_DESTRUCTIVE),
    Scenario("rename_paper", "Rename this paper to 'AIAYN'.",
             xfail_reason=_DESTRUCTIVE),
    Scenario("delete_paper", "Delete that paper.", xfail_reason=_DESTRUCTIVE),
    Scenario("move_folder", "Move my Inbox folder under Library.",
             xfail_reason=_DESTRUCTIVE),
    Scenario("rename_folder", "Rename Inbox to To-Read.",
             xfail_reason=_DESTRUCTIVE),
    Scenario("delete_folder", "Delete the To-Read folder.",
             xfail_reason=_DESTRUCTIVE),
    # GSD-55 citation pipeline — routes pending dual-auth migration
    Scenario("list_paper_citations", "What does this paper cite?",
             xfail_reason=_GSD55_PENDING,
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("list_paper_citation_edges",
             "Show me the citation graph for this paper.",
             xfail_reason=_GSD55_PENDING,
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("list_paper_citation_markers",
             "Where in the text are the citation markers?",
             xfail_reason=_GSD55_PENDING,
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("extract_paper_citations",
             "Pull out the bibliography from this paper.",
             xfail_reason=_GSD55_PENDING,
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("enrich_paper_citations",
             "Enrich the citations with abstracts.",
             xfail_reason=_GSD55_PENDING,
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("rematch_paper_citations",
             "Re-match the citations to my library.",
             xfail_reason=_GSD55_PENDING,
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("keep_paper_citation",
             "Keep this citation, drop the rest.",
             xfail_reason=_GSD55_PENDING,
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
    Scenario("save_paper_citation_to_library",
             "Save that citation into my library.",
             xfail_reason=_GSD55_PENDING + " + destructive",
             page_context={"paperId": "REPLACE_AT_RUNTIME"}),
]


@pytest.fixture(scope="module")
def session_cookie() -> str:
    """Log in via better-auth and return the session cookie header value."""
    with httpx.Client(base_url=_KM_URL, timeout=30) as client:
        r = client.post(
            "/api/auth/sign-in/email",
            json={"email": _USER, "password": _PASS},
        )
        r.raise_for_status()
        jar = "; ".join(f"{k}={v}" for k, v in client.cookies.items())
        if not jar:
            raise RuntimeError("login produced no cookies — check creds + KM_E2E_URL")
        return jar


def _scrape_tool_names(sse_text: str) -> set[str]:
    """Extract tool names from an SSE stream of agent events."""
    names: set[str] = set()
    for line in sse_text.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload:
            continue
        try:
            ev = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if not isinstance(ev, dict):
            continue
        if ev.get("type") == "tool_start" and isinstance(ev.get("name"), str):
            names.add(ev["name"])
        elif ev.get("event") == "on_tool_start":
            name = (ev.get("name")
                    or ev.get("data", {}).get("name") if isinstance(ev.get("data"), dict) else None)
            if isinstance(name, str):
                names.add(name)
    return names


@pytest.mark.parametrize(
    "scenario", SCENARIOS, ids=lambda s: s.tool,
)
def test_natural_language_selects_expected_tool(session_cookie: str, scenario: Scenario):
    if scenario.xfail_reason:
        pytest.xfail(scenario.xfail_reason)

    body = {
        "thread_id": f"e2e-{scenario.tool}-{uuid.uuid4().hex[:8]}",
        "message": scenario.prompt,
    }
    if scenario.page_context:
        body["page_context"] = scenario.page_context

    with httpx.Client(base_url=_KM_URL, timeout=120) as client:
        r = client.post(
            "/api/agents/km/invoke",
            json=body,
            headers={"Cookie": session_cookie},
        )
        assert r.status_code == 200, (
            f"{scenario.tool}: invoke returned {r.status_code} body={r.text[:300]}"
        )
        tools_called = _scrape_tool_names(r.text)

    assert scenario.tool in tools_called, (
        f"{scenario.tool} not selected from prompt {scenario.prompt!r}. "
        f"Tools called: {sorted(tools_called)}"
    )
