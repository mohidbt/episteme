"""KM Agent routes — /agents/km/{invoke,resume,state,config,extract}.

SSE library: StreamingResponse (consistent with existing km_complete.py).
Event format: event: <type>\ndata: <json>\n\n  (typed SSE per format_sse helper).

Recursion limit
---------------
LangGraph's default ``recursion_limit`` of 25 is too tight for Deep Agents
with subagents — every subagent invocation is its own multi-step graph
execution that bubbles back to the main agent, and a healthy lit-triage
flow easily plans + delegates + iterates beyond 25 steps. We set
``recursion_limit=100`` for both /invoke and /resume so the cap is loose
enough for legitimate runs while still bounding pathological loops
(§1.3b-E2E-fix-2).
"""
import asyncio
import json
import logging
import uuid
from functools import cache as _fn_cache

import openai
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from deps.auth import InternalAuthDep
from km_agent import build_km_agent
from skills import load_skills
from skills.drive_loader import DriveSkillsLoader
from checkpointer import get_saver
from store import get_store
from lib.config_cache import GUEST_USER_ID, load_user_config, save_user_config
from lib.km_http import km_get
from lib.openrouter_model import model_for
from lib.sse_events import _jsonable, format_sse, format_typed
from lib.message_metadata import (
    CITATIONS_KIND,
    fetch_thread_metadata,
    persist_message_metadata,
    schedule_persist,
)
from lib.thread_paper import (
    list_threads_for_paper,
    stamp_thread_paper_association,
)

# Per langgraph, ``recursion_limit`` bounds the number of super-steps a
# graph executes before raising ``GraphRecursionError``. Deep Agents with
# subagents need headroom; see module docstring.
_AGENT_RECURSION_LIMIT = 100

# Telemetry: emit a `recursion_step` SSE frame every N super-steps so we can
# observe how close real runs get to the limit. The boundary chosen is
# ``on_chain_end`` for ANY chain (every chain completion increments). This
# overcounts vs LangGraph's internal super-step counter — Deep Agents nest
# subgraphs — but it's a stable, observable signal: a doubling/tripling
# pattern means subagents are looping, which is exactly what we want to see.
# UI sub-counter: emit every step so the indicator advances visibly. We log
# at a coarser interval to keep server logs readable.
_RECURSION_STEP_INTERVAL = 1
_RECURSION_LOG_INTERVAL = 10

_GUEST_FORBIDDEN = {"error": "guests cannot use agents", "code": "guest_forbidden"}


@_fn_cache
def _data_extract_skill_body() -> str:
    """Cache lives here (not in the loader) so SKILLS_ROOT-monkeypatching tests stay valid."""
    [spec] = load_skills(["data-extract"])
    return spec.body()


def _reject_guest(user_id: str) -> None:
    """Raise 403 if the request is from the guest sentinel.

    Guests are restricted to the /complete and /chat P0 routes; agents require
    a real user_id (real config, real BYOK key, real workspace).
    """
    if user_id == GUEST_USER_ID:
        raise HTTPException(status_code=403, detail=_GUEST_FORBIDDEN)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agents/km", tags=["km-agent"])


# ---------------------------------------------------------------------------
# Event mapping
# ---------------------------------------------------------------------------

def _build_interrupt_payload(interrupt_id: str, value: object) -> dict | None:
    """Build interrupt SSE payload or return None to drop the event.

    Mirrors ``actions[0]`` onto legacy top-level keys so single-action
    consumers keep working alongside the batched ``actions`` list. Returns
    None (with a warning log) if neither the HITLRequest nor legacy shape is
    parseable — the SSE event is then suppressed entirely.
    """
    actions: list[dict] = []
    if isinstance(value, dict):
        action_requests = value.get("action_requests")
        review_configs = value.get("review_configs")
        if isinstance(action_requests, list) and action_requests:
            for idx, ar in enumerate(action_requests):
                if not isinstance(ar, dict):
                    continue
                rc = None
                if isinstance(review_configs, list) and idx < len(review_configs):
                    rc_candidate = review_configs[idx]
                    if isinstance(rc_candidate, dict):
                        rc = rc_candidate
                actions.append({
                    "tool_call_id": ar.get("id", "") or "",
                    "tool": ar.get("name", "") or "",
                    "args": ar.get("args", {}) or {},
                    "allowed_decisions": (rc.get("allowed_decisions", []) or []) if rc else [],
                })
        # Legacy hand-rolled shape — yields one action when action_requests absent.
        if not actions and value.get("tool"):
            actions.append({
                "tool_call_id": value.get("tool_call_id", "") or "",
                "tool": value.get("tool", "") or "",
                "args": value.get("args", {}) or {},
                "allowed_decisions": value.get("allowed_decisions", []) or [],
            })
    if not actions:
        logger.warning("interrupt %s has unparseable value shape; dropping event", interrupt_id)
        return None
    first = actions[0]
    return {
        "id": interrupt_id,
        "tool": first["tool"],
        "args": first["args"],
        "allowed_decisions": first["allowed_decisions"],
        "actions": actions,
    }


def _pending_action_requests(state) -> list[dict]:
    """Return action_requests from the first uncompleted interrupt in state.tasks.

    Used by /resume to learn how many decisions the langchain HITL middleware
    is waiting for, so the client can post a batched single approval and the
    server broadcasts it to N positional decisions.
    """
    for task in getattr(state, "tasks", None) or []:
        for interrupt in (getattr(task, "interrupts", None) or ()):
            value = getattr(interrupt, "value", interrupt)
            if isinstance(value, dict):
                ars = value.get("action_requests")
                if isinstance(ars, list):
                    return [a for a in ars if isinstance(a, dict)]
    return []


async def _flush_pending_interrupts(agent, thread_id: str) -> list[tuple[str, dict]]:
    """Read post-stream snapshot for pending HITL interrupts.

    `astream_events(version="v2")` does NOT surface `__interrupt__` in any
    `on_chain_end` output when langchain `HumanInTheLoopMiddleware` halts via
    `interrupt()` (verified empirically: tasks_with_interrupts populated in
    snapshot but no event dict has the key). Without this fallback, the
    frontend never sees an `interrupt` SSE frame and the user sees nothing
    after the model emits the gated tool_call.

    Returns a list of (event_type, payload) tuples ready to format_typed.

    NOTE: must use ``aget_state`` — sync ``get_state`` against
    ``AsyncPostgresSaver`` from the main asyncio thread raises
    ``Synchronous calls to AsyncPostgresSaver are only allowed from a
    different thread`` and silently swallows the interrupt flush.
    """
    out: list[tuple[str, dict]] = []
    try:
        snap = await agent.aget_state({"configurable": {"thread_id": thread_id}})
    except Exception as e:  # noqa: BLE001
        logger.warning("snapshot read for interrupt flush failed: %s", e)
        return out
    for task in snap.tasks or []:
        for interrupt in (getattr(task, "interrupts", None) or ()):
            value = getattr(interrupt, "value", interrupt)
            raw_id = getattr(interrupt, "id", "")
            if not isinstance(raw_id, str):
                logger.warning("interrupt id has unexpected type %s; coercing to \"\"", type(raw_id).__name__)
                interrupt_id = ""
            else:
                interrupt_id = raw_id
            payload = _build_interrupt_payload(interrupt_id, value)
            if payload is not None:
                out.append(("interrupt", payload))
    return out


def _map_event(ev: dict) -> tuple[str, dict] | None:
    """Map an astream_events v2 event to a (event_type, payload) pair.

    Returns None for events we don't emit.

    1.3a emitters (this file):
        text, tool_call, tool_result, interrupt, done

    TODO 1.3b: add emitters for thinking, todos, sources, skill_load, suggestion
    TODO 1.3c: file_diff is emitted from the Next.js route, not here
    """
    event_name = ev.get("event", "")
    run_id = ev.get("run_id", "")

    if event_name == "on_chat_model_stream":
        chunk = ev.get("data", {}).get("chunk")
        if chunk is None:
            return None
        content = getattr(chunk, "content", "") or ""
        if not content:
            return None
        return ("text", {"id": run_id, "delta": content})

    if event_name == "on_tool_start":
        name = ev.get("name", "tool")
        args = ev.get("data", {}).get("input") or {}
        return ("tool_call", {"id": run_id, "name": name, "args": args, "state": "input-available"})

    if event_name == "on_tool_end":
        raw_output = ev.get("data", {}).get("output")
        # Deep Agents built-in tools (write_todos, edit_file, task subagent)
        # return ``Command`` from on_tool_end. _jsonable explicitly extracts
        # ``update`` / ``goto`` / ``resume`` / ``graph`` so the SSE payload is
        # JSON-serializable (§1.3b-E2E-fix-1).
        if isinstance(raw_output, Command):
            output: object = _jsonable(raw_output)
        elif raw_output is not None:
            output = getattr(raw_output, "content", raw_output)
        else:
            output = None
        state = "output-error" if isinstance(raw_output, Exception) else "output-available"
        payload: dict = {"id": run_id, "state": state}
        if state == "output-available":
            payload["output"] = output
        else:
            payload["errorText"] = str(raw_output)
        return ("tool_result", payload)

    if event_name == "on_chat_model_end":
        # Round-C gap closure: emit a `usage` SSE event so the Next.js side
        # writes a row into `openrouter_usage`. LangChain attaches
        # `usage_metadata` to the AIMessage returned in `data.output`.
        #
        # `model` is intentionally left blank here — the streaming loops
        # overwrite it with their local `model_pref` before yield, because
        # LangChain's `response_metadata.model_name` accumulates across
        # streamed chunks and ends up duplicated by the time we see it.
        output = ev.get("data", {}).get("output")
        usage = getattr(output, "usage_metadata", None)
        if not isinstance(usage, dict):
            return None
        prompt_tokens = int(usage.get("input_tokens") or 0)
        completion_tokens = int(usage.get("output_tokens") or 0)
        if prompt_tokens == 0 and completion_tokens == 0:
            return None
        return ("usage", {
            "model": "",
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        })

    if event_name == "on_chain_end":
        output = ev.get("data", {}).get("output") or {}
        interrupts = output.get("__interrupt__") if isinstance(output, dict) else None
        if not interrupts:
            return None
        interrupt = interrupts[0]
        value = getattr(interrupt, "value", interrupt) if not isinstance(interrupt, dict) else interrupt
        raw_id = getattr(interrupt, "id", run_id)
        if not isinstance(raw_id, str):
            logger.warning("on_chain_end interrupt id has unexpected type %s; falling back to run_id", type(raw_id).__name__)
            interrupt_id = run_id
        else:
            interrupt_id = raw_id
        payload = _build_interrupt_payload(interrupt_id, value)
        if payload is None:
            return None
        return ("interrupt", payload)

    return None


def _extract_error_message(e: Exception) -> str:
    """Pull a user-friendly message out of an OpenAI/OpenRouter error.

    OpenRouter wraps upstream provider errors and surfaces a human string at
    ``e.body["error"]["metadata"]["raw"]``. Defensive: any structural mismatch
    falls back to ``str(e)``.
    """
    try:
        body = getattr(e, "body", None)
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                meta = err.get("metadata")
                if isinstance(meta, dict):
                    raw = meta.get("raw")
                    if isinstance(raw, str) and raw.strip():
                        return raw
                msg = err.get("message")
                if isinstance(msg, str) and msg.strip():
                    return msg
    except Exception:  # noqa: BLE001
        pass
    return str(e)


def _extract_rag_citations_from_tool_result(ev: dict, mapped: tuple[str, dict]) -> list[dict]:
    """Extract normalized citations from read_paper(kind='rag') tool output."""
    def _as_dict(value: object) -> dict | None:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:  # noqa: BLE001
                return None
            return parsed if isinstance(parsed, dict) else None
        # Some tool runtimes return content-block arrays. Pull the first text/json
        # payload and recurse so citation extraction survives shape drift.
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    for key in ("text", "content", "json"):
                        candidate = item.get(key)
                        parsed = _as_dict(candidate)
                        if parsed is not None:
                            return parsed
                else:
                    parsed = _as_dict(item)
                    if parsed is not None:
                        return parsed
        return None

    if mapped[0] != "tool_result":
        return []
    if ev.get("name") != "read_paper":
        return []
    output = _as_dict(mapped[1].get("output"))
    if output is None:
        return []
    paper_id = output.get("paper_id")
    if not isinstance(paper_id, str) or not paper_id:
        return []
    paper_title = output.get("paper_title") if isinstance(output.get("paper_title"), str) else None
    blocks = output.get("blocks")
    if not isinstance(blocks, list):
        return []

    # Round 2 (B3) — similarity floor + hard cap + dedup by
    # (paper_id, page, order_index). The block_id format is
    # ``{paper_id}:p{page}:{order_index}`` so it doubles as the dedup key.
    # Order is intentional: floor → dedup → cap. Applying the floor before
    # dedup avoids letting a low-score duplicate occupy the seen-set slot
    # when a subsequent block with the same key has a passing score. Dedup
    # first would drop the higher-quality block. (Codex R2 review.)
    similarity_floor = 0.35
    hard_cap = 12

    seen: set[tuple[str, int | None, str]] = set()
    citations: list[dict] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        chunk_id = block.get("block_id")
        page = block.get("page")
        if not isinstance(chunk_id, str):
            continue
        score = block.get("score")
        if not isinstance(score, (int, float)):
            continue
        if score < similarity_floor:
            continue

        # order_index trails the final ':' in block_id.
        try:
            order_index = chunk_id.rsplit(":", 1)[-1]
        except Exception:  # noqa: BLE001
            order_index = chunk_id
        dedup_key = (
            paper_id,
            page if isinstance(page, int) else None,
            order_index,
        )
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        # Title: paper-kind citations use ``{paper_title} - Page {page}``.
        # Falls back to chunk_id when title or page is missing — keeps the
        # sidebar from rendering blanks.
        if paper_title and isinstance(page, int):
            title = f"{paper_title} - Page {page}"
        elif paper_title:
            title = paper_title
        else:
            title = chunk_id

        citation: dict = {
            "chunk_id": chunk_id,
            "paper_id": paper_id,
            "title": title,
            "score": float(score),
            "snippet": (block.get("text") or "")[:280]
            if isinstance(block.get("text"), str)
            else "",
        }
        if isinstance(page, int):
            citation["page"] = page
        bbox = block.get("bbox")
        if isinstance(bbox, dict):
            citation["bbox"] = bbox
        citations.append(citation)
        if len(citations) >= hard_cap:
            break
    return citations


def _extra_events(ev: dict, mapped: tuple[str, dict]) -> list[tuple[str, dict]]:
    """Derive piggyback SSE events from a primary mapped event.

    write_todos returns Command(update={'todos': [...]}). The tool_result
    payload's output mirrors the Command.update dict (see _jsonable).
    Surface a separate `todos` event so the UI can render the plan list
    independently of the tool card.

    HITL interrupts no longer piggyback a tool_call: the InterruptCard
    already renders tool+args, and a piggyback card with a synthetic id
    (`int-tc-*`) was orphaned because the post-approval `on_tool_start`
    uses a fresh run_id, creating a duplicate "Running" card that never
    resolved.
    """
    if mapped[0] != "tool_result":
        return []
    extras: list[tuple[str, dict]] = []

    # Phase 1.5.1: read_paper may include server-side extraction progress
    # in tool output. Surface explicit progress frames for the UI.
    output = mapped[1].get("output")
    if isinstance(output, dict):
        progress = output.get("progress")
        if isinstance(progress, list):
            for item in progress:
                if (
                    isinstance(item, dict)
                    and item.get("type") == "pdf_extract_progress"
                    and isinstance(item.get("paper_id"), str)
                    and isinstance(item.get("stage"), str)
                ):
                    extras.append(
                        ("pdf_extract_progress", {
                            "paper_id": item["paper_id"],
                            "stage": item["stage"],
                        })
                    )

    if ev.get("name") != "write_todos":
        return extras
    if not isinstance(output, dict):
        return extras
    update = output.get("update")
    items = update.get("todos") if isinstance(update, dict) else None
    if not isinstance(items, list):
        return extras
    # Upstream Todo schema (langchain.agents.middleware.todo) has only
    # `content` + `status`; no stable id. Inject a deterministic positional
    # id so the React keys are always present (warning at AgentTranscript:264).
    enriched: list = []
    for idx, item in enumerate(items):
        if isinstance(item, dict) and "id" not in item:
            enriched.append({**item, "id": f"todo-{idx}"})
        else:
            enriched.append(item)
    extras.append(("todos", {"items": enriched}))
    return extras


def _build_reader_context_prefix(active_paper_id: str) -> str:
    """Build the `[reader-context]` system prefix for the PDF side-panel agent.

    Names ONLY tools guaranteed available regardless of which skill the user
    has enabled (see ``_CORE_TOOL_NAMES`` in ``km_agent.py``). Mentioning a
    skill-gated tool here (e.g. ``search_library``) caused hallucination /
    error loops when the active skill pruned that tool — the model would
    repeatedly try to call a name it had been told to use.
    """
    return (
        f"[reader-context] You are answering inside the PDF reader for "
        f"paper_id={active_paper_id}. Prefer tools scoped to this paper:\n"
        f"- read_paper(paper_id=\"{active_paper_id}\", scope=...) for full or "
        f"multi-page text;\n"
        f"- read_paper(paper_id=\"{active_paper_id}\", scope={{'kind': 'pages', "
        f"'range': [n-1, n]}}) to read a single page;\n"
        f"- pdf_explain_passage(paper_id=\"{active_paper_id}\", page=N, "
        f"text=\"...\") to explain a selected passage;\n"
        f"- find_papers(query=\"...\") to find or list papers (omit query "
        f"to list all).\n"
        f"If read_paper(scope.kind=\"rag\") returns zero blocks, do not stop: "
        f"immediately retry with a simpler query, then fall back to "
        f"read_paper(scope.kind=\"full\") and continue.\n"
        f"Use these names verbatim. Do NOT invent tools (e.g. read_pdf) and do "
        f"NOT call search_library — it is skill-gated and may be unavailable."
    )


def _build_configurable(
    *,
    thread_id: str,
    user_id: str,
    auth: dict,
    active_paper_id: str | None,
    run_id: str | None = None,
) -> dict:
    """Build the ``configurable`` dict for ``RunnableConfig``.

    Tools (read_paper, pdf_explain_passage) read
    ``configurable.ocr_key`` via
    ``services/agents/tools/papers.py:_ocr_key_from_config`` and will fail
    fast if it's missing. The HMAC ``auth`` dict from
    ``deps.auth.require_internal`` carries the per-user OCR/LLM keys —
    propagate them here so every agent run has the runtime context tools
    need.
    """
    configurable: dict = {"thread_id": thread_id, "user_id": user_id}
    if active_paper_id:
        configurable["paper_id"] = active_paper_id
    if run_id:
        # B5 — stable run_id scoped to this single /invoke (or /resume) call.
        # Tools (e.g. tools/pdfs.py::highlight) read it via RunnableConfig so
        # multiple highlight() invocations within one turn share a runId.
        configurable["run_id"] = run_id
    ocr_key = auth.get("ocr_key") if isinstance(auth, dict) else None
    if not ocr_key and isinstance(auth, dict):
        # Defensive fallback: older callers may only send llm_key. read_paper
        # still requires configurable.ocr_key, and current Next.js routes
        # already mirror this llm->ocr fallback on the outbound hop.
        ocr_key = auth.get("llm_key")
    if ocr_key:
        configurable["ocr_key"] = ocr_key
    llm_key = auth.get("llm_key") if isinstance(auth, dict) else None
    if llm_key:
        configurable["llm_key"] = llm_key
    return configurable


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/invoke")
async def invoke(req: Request, auth: InternalAuthDep):
    _reject_guest(auth["user_id"])
    body = await req.json()
    user_id = auth["user_id"]
    cfg = load_user_config(user_id)
    # Postgres is source of truth for modelPreference + enabledSkills — Next.js
    # passes them on the wire so a cold Python cache can't fall back to the
    # default free model or strip skill context (SkillsMiddleware never wired).
    model_pref = body.get("model_preference") or cfg["modelPreference"]
    enabled = body.get("enabled_skills")
    if not isinstance(enabled, list):
        enabled = cfg.get("enabledSkills", [])
    permissions = body.get("permissions")
    if not isinstance(permissions, dict):
        permissions = cfg.get("permissions", {})
    agent = await build_km_agent(
        user_id=user_id,
        thread_id=body["thread_id"],
        model=model_for(model_pref, auth["llm_key"]),
        enabled_skills=enabled,
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
        permissions=permissions,
    )

    # Page context (paperId/noteId/...) — when set, propagate via configurable
    # so tools can default to the active resource, AND prepend the reader
    # context as a SystemMessage so the model picks paper-scoped tools
    # (read_paper / pdf_explain_passage / search_pdfs /
    # list_pdfs) — see ``_build_reader_context_prefix`` for the exact tool
    # list named to the LLM.
    #
    # Round 4 / B10: the reader-context MUST NOT be concatenated onto the
    # user's text. Doing so persisted the preamble into the human message via
    # the checkpointer and the transcript UI replayed it on every hydration.
    # System role keeps it out of the visible history while still steering
    # tool selection.
    page_context = body.get("page_context") or {}
    if not isinstance(page_context, dict):
        page_context = {}
    active_paper_id = page_context.get("paperId") if isinstance(page_context.get("paperId"), str) else None
    user_message = body["message"]
    input_messages: list[dict] = []
    if active_paper_id:
        input_messages.append({
            "role": "system",
            "content": _build_reader_context_prefix(active_paper_id),
        })
    input_messages.append({"role": "user", "content": user_message})

    async def gen():
        step = 0
        thread_id = body["thread_id"]
        pending_citations: list[dict] = []
        # G1: track run_ids from on_tool_start so we can emit synthetic
        # output-error frames for any tool that never received on_tool_end.
        active_tool_run_ids: set[str] = set()
        # B5 — one stable run_id per /invoke call. Shared across every tool
        # invocation in this turn so highlight() rows group under a single
        # reader-sidebar run.
        invoke_run_id = str(uuid.uuid4())
        configurable = _build_configurable(
            thread_id=thread_id,
            user_id=user_id,
            auth=auth,
            active_paper_id=active_paper_id,
            run_id=invoke_run_id,
        )
        # K8 — stamp thread→paper association so the reader sidebar can list
        # past agent threads scoped to the open paper. Fire-and-forget with
        # task retention; failures are logged + swallowed.
        if active_paper_id:
            schedule_persist(
                stamp_thread_paper_association(
                    thread_id=thread_id,
                    paper_id=active_paper_id,
                    user_id=user_id,
                )
            )
        try:
            try:
                async for ev in agent.astream_events(
                    {"messages": input_messages},
                    config={
                        "configurable": configurable,
                        "recursion_limit": _AGENT_RECURSION_LIMIT,
                    },
                    version="v2",
                ):
                    if ev.get("event") == "on_chain_end":
                        step += 1
                        if step % _RECURSION_LOG_INTERVAL == 0:
                            logger.info(
                                "agent recursion step=%d thread_id=%s",
                                step, thread_id,
                            )
                        if step % _RECURSION_STEP_INTERVAL == 0:
                            yield format_typed(
                                "recursion_step",
                                {"step": step, "limit": _AGENT_RECURSION_LIMIT},
                            )
                    # G1: track in-flight tool run_ids
                    ev_name = ev.get("event", "")
                    ev_run_id = ev.get("run_id", "")
                    if ev_name == "on_tool_start" and ev_run_id:
                        active_tool_run_ids.add(ev_run_id)
                    elif ev_name == "on_tool_end" and ev_run_id:
                        active_tool_run_ids.discard(ev_run_id)
                    mapped = _map_event(ev)
                    if mapped:
                        # Fill in the model id on usage events from the
                        # streaming loop's local var — see _map_event for why
                        # response_metadata.model_name is unreliable.
                        if mapped[0] == "usage" and isinstance(model_pref, str):
                            mapped[1]["model"] = model_pref
                        extracted = _extract_rag_citations_from_tool_result(ev, mapped)
                        if extracted:
                            pending_citations = extracted
                        if mapped[0] == "text" and pending_citations:
                            payload = dict(mapped[1])
                            payload["citations"] = pending_citations
                            yield format_typed(mapped[0], payload)
                            yield format_typed("sources", {
                                "message_id": payload["id"],
                                "citations": pending_citations,
                            })
                            # Persist into agent_message_metadata directly off
                            # the SSE message_id — no checkpoint id matching.
                            # Fire-and-forget so DB latency never blocks the
                            # stream; persistence is best-effort.
                            msg_id = payload.get("id")
                            if isinstance(msg_id, str) and msg_id:
                                schedule_persist(persist_message_metadata(
                                    thread_id=thread_id,
                                    user_id=user_id,
                                    message_id=msg_id,
                                    kind=CITATIONS_KIND,
                                    payload=pending_citations,
                                ))
                            pending_citations = []
                        else:
                            yield format_typed(mapped[0], mapped[1])
                        for extra in _extra_events(ev, mapped):
                            yield format_typed(extra[0], extra[1])
                for ev_type, payload in await _flush_pending_interrupts(agent, thread_id):
                    yield format_typed(ev_type, payload)
            except asyncio.CancelledError:
                logger.info("agent stream cancelled thread_id=%s", thread_id)
                raise
            except openai.RateLimitError as e:
                logger.warning("agent stream rate-limited: %s", e)
                is_free = isinstance(model_pref, str) and model_pref.endswith(":free")
                if is_free:
                    message = (
                        "OpenRouter's free-tier limit for this model has been reached. "
                        "You can wait until the daily quota resets, or switch to a paid "
                        "model in Settings → Agent."
                    )
                else:
                    message = _extract_error_message(e)
                yield format_typed("error", {
                    "code": "rate_limited",
                    "message": message,
                    "retriable": True,
                })
            except Exception as e:  # noqa: BLE001
                logger.exception("agent stream failed")
                yield format_typed("error", {
                    "code": "internal_error",
                    "message": str(e),
                    "retriable": False,
                })
        finally:
            # G1: emit synthetic output-error for any tool that started but
            # never completed (covers CancelledError + any other early exit).
            for orphan_run_id in active_tool_run_ids:
                logger.warning(
                    "agent stream ended before tool completed run_id=%s thread_id=%s",
                    orphan_run_id, thread_id,
                )
                yield format_typed("tool_result", {
                    "id": orphan_run_id,
                    "state": "output-error",
                    "errorText": "stream ended",
                })
            # Citation persistence happens inline during the stream (see
            # `persist_message_metadata` fire-and-forget above). No
            # post-stream stamp needed — failure modes degrade to "citations
            # missing on reload" rather than corrupted checkpoint state.
            # yield-in-finally trade-off: Python async-gen spec says that
            # yielding inside finally is undefined behaviour when the generator
            # is closed via aclose() / GeneratorExit — the frame may or may not
            # be delivered. In our SSE context this is acceptable: aclose() is
            # only triggered when the HTTP client disconnects, at which point
            # there is no consumer left to receive the bytes anyway. We keep
            # the yield here so clean-EOF paths (no cancellation) always get a
            # terminal "done" frame. If the client is gone, the silent drop is
            # harmless.
            yield format_sse("done", {"thread_id": thread_id})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/resume")
async def resume(req: Request, auth: InternalAuthDep):
    _reject_guest(auth["user_id"])
    body = await req.json()
    user_id = auth["user_id"]
    cfg = load_user_config(user_id)
    model_pref = body.get("model_preference") or cfg["modelPreference"]
    enabled = body.get("enabled_skills")
    if not isinstance(enabled, list):
        enabled = cfg.get("enabledSkills", [])
    permissions = body.get("permissions")
    if not isinstance(permissions, dict):
        permissions = cfg.get("permissions", {})
    agent = await build_km_agent(
        user_id=user_id,
        thread_id=body["thread_id"],
        model=model_for(model_pref, auth["llm_key"]),
        enabled_skills=enabled,
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
        permissions=permissions,
    )

    # langchain HumanInTheLoopMiddleware reads the resume payload as
    # ``interrupt(...)["decisions"]`` of length N, where N == number of
    # gated ``action_requests`` in the pending interrupt. Phase 1.9f: when
    # the model planned N parallel calls in one turn, the UI sends ONE
    # batched decision; we look up N from the checkpoint and broadcast.
    raw_decisions = body.get("decisions") or []
    client_decisions: list[dict] = []
    for d in raw_decisions:
        if not isinstance(d, dict):
            continue
        out: dict = {"type": d.get("type") or d.get("action") or "approve"}
        if "message" in d:
            out["message"] = d["message"]
        if "edited_action" in d:
            out["edited_action"] = d["edited_action"]
        if "tool_call_id" in d:
            out["tool_call_id"] = d["tool_call_id"]
        client_decisions.append(out)

    thread_id = body["thread_id"]
    try:
        snap = await agent.aget_state({"configurable": {"thread_id": thread_id}})
        pending = _pending_action_requests(snap)
    except Exception as e:  # noqa: BLE001
        logger.warning("resume: state lookup failed (%s); forwarding decisions verbatim", e)
        pending = []

    n_pending = len(pending)
    if n_pending == 0:
        # Couldn't determine N (state lookup empty/failed) — pass through.
        resolved = client_decisions
    elif len(client_decisions) == n_pending:
        resolved = client_decisions
    elif len(client_decisions) == 1:
        # Batched single approval — broadcast to all pending action_requests.
        template = client_decisions[0]
        resolved = [dict(template) for _ in range(n_pending)]
    else:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "decision_count_mismatch",
                "message": f"Got {len(client_decisions)} decisions, expected {n_pending} or 1.",
                "expected": n_pending,
                "received": len(client_decisions),
            },
        )

    resume_payload = {"decisions": resolved}

    async def gen():
        step = 0
        thread_id = body["thread_id"]
        resume_run_id = str(uuid.uuid4())
        configurable = _build_configurable(
            thread_id=thread_id,
            user_id=user_id,
            auth=auth,
            active_paper_id=None,
            run_id=resume_run_id,
        )
        # Match /invoke citation handling so a resumed RAG tool call still
        # emits the `sources` event consumed by the UI. (Codex senior review.)
        pending_citations: list[dict] = []
        try:
            async for ev in agent.astream_events(
                Command(resume=resume_payload),
                config={
                    "configurable": configurable,
                    "recursion_limit": _AGENT_RECURSION_LIMIT,
                },
                version="v2",
            ):
                if ev.get("event") == "on_chain_end":
                    step += 1
                    if step % _RECURSION_LOG_INTERVAL == 0:
                        logger.info(
                            "agent recursion step=%d thread_id=%s",
                            step, thread_id,
                        )
                    if step % _RECURSION_STEP_INTERVAL == 0:
                        yield format_typed(
                            "recursion_step",
                            {"step": step, "limit": _AGENT_RECURSION_LIMIT},
                        )
                mapped = _map_event(ev)
                if mapped:
                    if mapped[0] == "usage" and isinstance(model_pref, str):
                        mapped[1]["model"] = model_pref
                    extracted = _extract_rag_citations_from_tool_result(ev, mapped)
                    if extracted:
                        pending_citations = extracted
                    if mapped[0] == "text" and pending_citations:
                        payload = dict(mapped[1])
                        payload["citations"] = pending_citations
                        yield format_typed(mapped[0], payload)
                        yield format_typed("sources", {
                            "message_id": payload["id"],
                            "citations": pending_citations,
                        })
                        msg_id = payload.get("id")
                        if isinstance(msg_id, str) and msg_id:
                            schedule_persist(persist_message_metadata(
                                thread_id=thread_id,
                                user_id=user_id,
                                message_id=msg_id,
                                kind=CITATIONS_KIND,
                                payload=pending_citations,
                            ))
                        pending_citations = []
                    else:
                        yield format_typed(mapped[0], mapped[1])
                    for extra in _extra_events(ev, mapped):
                        yield format_typed(extra[0], extra[1])
            for ev_type, payload in await _flush_pending_interrupts(agent, thread_id):
                yield format_typed(ev_type, payload)
        except openai.RateLimitError as e:
            logger.warning("agent stream rate-limited: %s", e)
            is_free = isinstance(model_pref, str) and model_pref.endswith(":free")
            if is_free:
                message = (
                    "OpenRouter's free-tier limit for this model has been reached. "
                    "You can wait until the daily quota resets, or switch to a paid "
                    "model in Settings → Agent."
                )
            else:
                message = _extract_error_message(e)
            yield format_typed("error", {
                "code": "rate_limited",
                "message": message,
                "retriable": True,
            })
        except Exception as e:  # noqa: BLE001
            logger.exception("agent stream failed")
            yield format_typed("error", {
                "code": "internal_error",
                "message": str(e),
                "retriable": False,
            })
        yield format_sse("done", {"thread_id": body["thread_id"]})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


def _extract_text(raw) -> str:
    """Pull plain text out of a LangChain content payload (str | list[block])."""
    if isinstance(raw, list):
        return "".join(
            part.get("text", "") for part in raw if isinstance(part, dict)
        )
    return str(raw or "")


def _serialize_message(msg) -> dict | None:
    """Serialize a LangChain BaseMessage into a hydration-friendly dict.

    Shape:
        {"id": str, "role": "user"|"assistant", "text": str, "parts"?: [...]}

    For AI messages with tool_calls, `parts` interleaves text + tool-call
    entries so the UI can rebuild the rich `<Tool>` cards on history hydration
    (G-R3-07 #78). Tool results live on separate ToolMessages and are folded
    in by `_serialize_messages_with_tools` below — we cannot do it here
    because a single _serialize_message call only sees one message.

    Returns None for non-displayable types (tool messages handled at the
    list-level join, system messages skipped).
    """
    msg_type = getattr(msg, "type", None)
    if msg_type == "human":
        role = "user"
    elif msg_type == "ai":
        role = "assistant"
    else:
        return None

    text = _extract_text(getattr(msg, "content", ""))
    tool_calls = list(getattr(msg, "tool_calls", []) or [])

    msg_id = getattr(msg, "id", None) or f"{role}-{id(msg)}"
    out: dict = {"id": str(msg_id), "role": role, "text": text}

    # Citations going forward live in `agent_message_metadata` (merged into
    # /state below). Read-only legacy compat: pre-migration threads still
    # carry citations stamped into AIMessage.additional_kwargs; surface
    # them so those threads don't visibly lose their pills on reload.
    # /state metadata merge overwrites this when a fresh row exists.
    if role == "assistant":
        kwargs = getattr(msg, "additional_kwargs", None) or {}
        legacy = kwargs.get("citations")
        if isinstance(legacy, list) and legacy:
            out["citations"] = legacy

    if role == "assistant" and tool_calls:
        parts: list[dict] = []
        if text.strip():
            parts.append({"type": "text", "text": text})
        for tc in tool_calls:
            # tool_calls are dicts on AIMessage: {id, name, args}
            parts.append(
                {
                    "type": "tool-call",
                    "id": str(tc.get("id") or f"tc-{id(tc)}"),
                    "name": str(tc.get("name") or ""),
                    "args": tc.get("args") or {},
                }
            )
        out["parts"] = parts
        return out

    if not text.strip():
        return None
    return out


def _serialize_messages_with_tools(raw_messages: list) -> list[dict]:
    """List-level serializer that folds ToolMessage results back into the
    preceding assistant message's `parts` array.

    Walks the LangChain message list once. For every ToolMessage we find,
    locate the most recent assistant message with a tool-call matching its
    `tool_call_id` and append a `tool-result` part. This rebuilds the
    text/tool/text/tool/text shape the live SSE reducer produces.
    """
    serialized: list[dict] = []
    # Index from tool_call_id -> assistant-message dict so we can append
    # results without an O(n^2) scan.
    by_call_id: dict[str, dict] = {}

    for m in raw_messages:
        msg_type = getattr(m, "type", None)
        if msg_type == "tool":
            call_id = str(getattr(m, "tool_call_id", "") or "")
            target = by_call_id.get(call_id)
            if target is None:
                continue
            content = _extract_text(getattr(m, "content", ""))
            status = getattr(m, "status", None)
            part: dict = {"type": "tool-result", "id": call_id}
            if status == "error":
                part["errorText"] = content
            else:
                part["output"] = content
            target.setdefault("parts", []).append(part)
            continue

        s = _serialize_message(m)
        if s is None:
            continue
        serialized.append(s)
        for part in s.get("parts", []):
            if part.get("type") == "tool-call":
                by_call_id[part["id"]] = s

    return serialized


@router.get("/state/{thread_id}")
async def state(thread_id: str, auth: InternalAuthDep):
    _reject_guest(auth["user_id"])
    caller_user_id = auth["user_id"]
    saver = get_saver()
    config = {"configurable": {"thread_id": thread_id}}
    tuple_ = await saver.aget_tuple(config)
    if tuple_ is None:
        return {"todos": [], "pending_interrupts": [], "messages": []}
    # BG1#7 owner-check (best-effort). LangGraph threads have no first-class
    # owner table; we propagate `user_id` into `RunnableConfig.configurable`
    # at /invoke and /resume (see `_build_configurable`), and the checkpointer
    # persists it on the saved config. If a mismatch is detectable we 403;
    # if no user_id is present (older threads, or a checkpointer that didn't
    # round-trip configurable), we fall through and serve. ACCEPTED RISK:
    # threads written before this stamping land in the no-owner bucket and
    # remain readable cross-user. Proper fix requires a thread->user table.
    tuple_cfg = getattr(tuple_, "config", None) or {}
    tuple_configurable = tuple_cfg.get("configurable") if isinstance(tuple_cfg, dict) else None
    owner_user_id = (
        tuple_configurable.get("user_id")
        if isinstance(tuple_configurable, dict)
        else None
    )
    if isinstance(owner_user_id, str) and owner_user_id and owner_user_id != caller_user_id:
        from fastapi import HTTPException  # noqa: PLC0415
        raise HTTPException(status_code=403, detail="thread not owned by caller")
    channel_values = tuple_.checkpoint.get("channel_values", {})
    todos = channel_values.get("todos", [])
    raw_messages = channel_values.get("messages", []) or []
    messages = _serialize_messages_with_tools(raw_messages)

    # Merge per-message extras (citations + future kinds) from the side
    # table. Keyed off the SSE-emitted message_id which is what the writer
    # stamped. Filtered by (thread_id, user_id) so route-level auth has
    # defense-in-depth at the data layer.
    metadata = await fetch_thread_metadata(
        thread_id=thread_id, user_id=caller_user_id,
    )
    if metadata:
        # LangChain prefixes checkpoint AIMessage.id with ``lc_run--`` (and
        # sometimes ``run--``) while the SSE event ``run_id`` we persist off
        # is the raw UUID. Try both the literal id and the prefix-stripped
        # variant so persisted citations rehydrate regardless of which form
        # the checkpoint stored.
        for msg in messages:
            mid = msg.get("id")
            if not isinstance(mid, str):
                continue
            candidates = [mid]
            for prefix in ("lc_run--", "run--"):
                if mid.startswith(prefix):
                    candidates.append(mid[len(prefix):])
            cits = None
            for key in candidates:
                cits = metadata.get((key, CITATIONS_KIND))
                if cits is not None:
                    break
            if cits is not None:
                msg["citations"] = cits

    # pending_interrupts detail deferred to 1.3b
    return {
        "todos": todos,
        "pending_interrupts": [],
        "messages": messages,
    }


@router.get("/threads-for-paper/{paper_id}")
async def threads_for_paper(paper_id: str, auth: InternalAuthDep):
    """List recent agent threads for the given paper owned by the caller.

    K8 — powers the reader sidebar's "past threads on this paper" dropdown.
    Owner-scoped: filters by auth.user_id so cross-tenant thread_ids are
    never disclosed. Returns at most 50 rows ordered by created_at DESC.
    """
    _reject_guest(auth["user_id"])
    threads = await list_threads_for_paper(
        paper_id=paper_id, user_id=auth["user_id"]
    )
    return {"threads": threads}


@router.post("/config")
async def config_post(req: Request, auth: InternalAuthDep):
    _reject_guest(auth["user_id"])
    body = await req.json()
    save_user_config(auth["user_id"], body)
    return {"ok": True}


_EXTRACT_CONCURRENCY = 4


def _extract_filled_payload(ev: dict) -> dict | None:
    """If `ev` is a successful csv_write_cell tool_end, return the cell_filled payload.

    The agent calls ``csv_write_cell(file_id, row, col, value, grounding)``;
    on success the tool returns the literal string ``"ok"``. We mine the
    on_tool_end's ``data.input`` (preserved by langchain when both input and
    output are passed through) for the structured args.
    """
    if ev.get("event") != "on_tool_end" or ev.get("name") != "csv_write_cell":
        return None
    data = ev.get("data") or {}
    output = data.get("output")
    text = getattr(output, "content", output)
    if isinstance(output, Exception):
        return None
    if isinstance(text, str) and not text.startswith("ok"):
        # csv_write_cell returns "error: ..." on KM-side rejection.
        return None
    args = data.get("input") or {}
    if not isinstance(args, dict):
        return None
    return {
        "row": args.get("row"),
        "col": args.get("col"),
        "value": args.get("value"),
        "grounding": args.get("grounding") or {},
    }


@router.post("/extract")
async def extract(req: Request, auth: InternalAuthDep):
    """Real SSE handler for the data-extract workflow (Phase 1.4.x-T6).

    Per-cell fan-out with ``asyncio.Semaphore(4)`` cap; each cell runs in its
    own checkpoint thread (``extract:<paperset>:<row>:<col>``); per-cell errors
    emit ``cell_failed`` and the stream continues. Replaces the 501 stub from
    phase-1.4 T0.

    Body:
        ``{"paperset_id": str, "cells": [{"row_idx": int, "col_name": str}, ...]}``

    SSE events: cell_started, tool_call, tool_result, cell_filled, cell_failed,
    done {filled, failed}.
    """
    _reject_guest(auth["user_id"])
    body = await req.json()
    user_id = auth["user_id"]
    ocr_key = auth.get("ocr_key", "") or ""

    paperset_id = body.get("paperset_id")
    cells = body.get("cells")
    if not isinstance(paperset_id, str) or not paperset_id:
        raise HTTPException(status_code=400, detail={"error": "paperset_id_required"})
    if not isinstance(cells, list) or not cells:
        raise HTTPException(status_code=400, detail={"error": "cells_required"})
    for c in cells:
        if not isinstance(c, dict):
            raise HTTPException(status_code=400, detail={"error": "validation"})
        if not isinstance(c.get("row_idx"), int) or c["row_idx"] < 0:
            raise HTTPException(status_code=400, detail={"error": "validation"})
        if not isinstance(c.get("col_name"), str) or not c["col_name"]:
            raise HTTPException(status_code=400, detail={"error": "validation"})

    # Resolve column descriptions + paper_ids from the KM-side paperset view.
    pset = await km_get(f"/api/papersets/{paperset_id}/csv-view", user_id=user_id)
    if not isinstance(pset, dict) or pset.get("error"):
        raise HTTPException(status_code=502, detail={"error": "paperset_fetch_failed"})

    columns = pset.get("columns") or []
    row_refs = pset.get("row_refs") or []
    col_by_name = {c["name"]: c for c in columns if isinstance(c, dict) and "name" in c}

    for c in cells:
        if c["row_idx"] >= len(row_refs):
            raise HTTPException(status_code=400, detail={"error": "row_oob"})
        if c["col_name"] not in col_by_name:
            raise HTTPException(status_code=400, detail={"error": "unknown_col"})

    cfg = load_user_config(user_id)
    model_pref = body.get("model_preference") or cfg["modelPreference"]
    permissions = cfg.get("permissions", {})
    agent = await build_km_agent(
        user_id=user_id,
        thread_id=f"extract:{paperset_id}",
        model=model_for(model_pref, auth["llm_key"]),
        enabled_skills=["data-extract"],
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
        permissions=permissions,
    )

    sem = asyncio.Semaphore(_EXTRACT_CONCURRENCY)
    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()

    skill_body = _data_extract_skill_body()

    async def run_cell(cell: dict) -> bool:
        row = cell["row_idx"]
        col = cell["col_name"]
        async with sem:
            await queue.put(("cell_started", {"row": row, "col": col}))
            paper_id = (row_refs[row] or {}).get("paper_id", "")
            description = col_by_name[col].get("description", "")
            prompt = (
                f"{skill_body}\n\n"
                "---\n\n# Current task\n"
                f"Fill cell (row={row}, col=\"{col}\") in paperset file_id={paperset_id}.\n"
                f"Target paper_id: {paper_id}\n"
                f"Column description (your extraction prompt): {description}\n"
            )
            tid = f"extract:{paperset_id}:{row}:{col}"
            filled_payload: dict | None = None
            try:
                async for ev in agent.astream_events(
                    {"messages": [{"role": "user", "content": prompt}]},
                    config={
                        "configurable": {
                            "thread_id": tid,
                            "user_id": user_id,
                            "ocr_key": ocr_key,
                            "allow_direct_csv_write": True,
                        },
                        "recursion_limit": _AGENT_RECURSION_LIMIT,
                    },
                    version="v2",
                ):
                    mapped = _map_event(ev)
                    if mapped:
                        ev_type, payload = mapped
                        if ev_type in ("tool_call", "tool_result"):
                            tagged = {**payload, "row": row, "col": col}
                            await queue.put((ev_type, tagged))
                    candidate = _extract_filled_payload(ev)
                    if candidate is not None:
                        filled_payload = candidate
            except Exception as e:  # noqa: BLE001
                logger.exception("extract cell failed row=%s col=%s", row, col)
                await queue.put(("cell_failed", {"row": row, "col": col, "error": str(e)}))
                return False
            if filled_payload is None:
                await queue.put((
                    "cell_failed",
                    {"row": row, "col": col, "error": "agent did not write cell"},
                ))
                return False
            # Normalize row/col on the filled payload (the agent might mismatch).
            await queue.put((
                "cell_update",
                {
                    "row": row,
                    "col": col,
                    "value": filled_payload.get("value"),
                    "grounding": filled_payload.get("grounding") or {},
                },
            ))
            return True

    async def run_all() -> None:
        results = await asyncio.gather(
            *[run_cell(c) for c in cells], return_exceptions=True,
        )
        filled = sum(1 for r in results if r is True)
        failed = len(results) - filled
        await queue.put(("done", {"filled": filled, "failed": failed}))
        await queue.put((SENTINEL, None))

    async def gen():
        task = asyncio.create_task(run_all())
        try:
            while True:
                item = await queue.get()
                ev_type, payload = item
                if ev_type is SENTINEL:
                    break
                yield format_sse(ev_type, payload)
        finally:
            await task

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/debug/loaded_skills")
async def debug_loaded_skills(
    auth: InternalAuthDep,
    only: list[str] = Query(default_factory=list),  # noqa: B008
):
    """Debug-only: assert load_skills() resolves the requested skill names.

    HMAC-gated like every other agent route — no unauthenticated info leak.
    Used by scripts/check-skill-addition.ts (PRD §5.4.7 scalability gate) to
    verify a fixture skill loads BEFORE the /invoke smoke. Without this,
    /invoke returning 200 could mask a silently-skipped skill (Strengthen #1).

    Behavior contract:
    - Empty `only` → []
    - Unknown name in `only` → 500 (DriveSkillsLoader raises KeyError)
    - Known names → list of {name, tools, subagents} per resolved spec
    """
    _reject_guest(auth["user_id"])
    try:
        specs = await DriveSkillsLoader().load(only, user_id=auth["user_id"])
    except KeyError as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    return [
        {
            "name": s.name,
            "tools": list(s.tools),
            "subagents": list(s.subagents),
        }
        for s in specs
    ]


@router.get("/skills/personal", include_in_schema=False)
async def diag_personal_skills(auth: InternalAuthDep):
    """Diagnostic: return personal-skill state for the authed user.

    INTERNAL-ONLY. Excluded from /docs OpenAPI (``include_in_schema=False``).
    Hits the same KM endpoint and parses the same shape as build_km_agent's
    ``_fetch_personal_skills``, so the response answers "what would the agent
    have seen if I called /invoke right now?". Useful for verifying K4
    virtual SKILL.md plumbing in prod when the user reports "no skills found".

    Returns ``{count, slugs, error_status, error_kind}``. We deliberately
    strip the upstream response body to avoid leaking arbitrary content
    from the KM service through this diagnostic surface.
    """
    _reject_guest(auth["user_id"])
    user_id = auth["user_id"]
    resp = await km_get("/api/agents/skills/personal", user_id=user_id)
    if isinstance(resp, dict) and resp.get("error") is True:
        # NEVER echo resp.get("body") here — that's arbitrary upstream content.
        # Surface only the structured shape (status + kind) for diagnosis.
        return {
            "count": 0,
            "slugs": [],
            "error_status": resp.get("status"),
            "error_kind": str(resp.get("kind") or "fetch_failed"),
        }
    skills: list = []
    if isinstance(resp, dict) and isinstance(resp.get("skills"), list):
        skills = [s for s in resp["skills"] if isinstance(s, dict)]
    slugs = [str(s.get("slug") or s.get("name") or "") for s in skills]
    slugs = [s for s in slugs if s]
    return {
        "count": len(slugs),
        "slugs": slugs,
        "error_status": None,
        "error_kind": None,
    }
