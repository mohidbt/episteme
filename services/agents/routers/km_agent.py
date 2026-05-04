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
import logging

import openai
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from deps.auth import InternalAuthDep
from km_agent import build_km_agent
from skills.drive_loader import DriveSkillsLoader
from checkpointer import get_saver
from store import get_store
from lib.config_cache import GUEST_USER_ID, load_user_config, save_user_config
from lib.km_http import km_get
from lib.openrouter_model import model_for
from lib.sse_events import _jsonable, format_sse, format_typed

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
_RECURSION_STEP_INTERVAL = 10

_GUEST_FORBIDDEN = {"error": "guests cannot use agents", "code": "guest_forbidden"}


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

def _flush_pending_interrupts(agent, thread_id: str) -> list[tuple[str, dict]]:
    """Read post-stream snapshot for pending HITL interrupts.

    `astream_events(version="v2")` does NOT surface `__interrupt__` in any
    `on_chain_end` output when langchain `HumanInTheLoopMiddleware` halts via
    `interrupt()` (verified empirically: tasks_with_interrupts populated in
    snapshot but no event dict has the key). Without this fallback, the
    frontend never sees an `interrupt` SSE frame and the user sees nothing
    after the model emits the gated tool_call.

    Returns a list of (event_type, payload) tuples ready to format_typed.
    """
    out: list[tuple[str, dict]] = []
    try:
        snap = agent.get_state({"configurable": {"thread_id": thread_id}})
    except Exception as e:  # noqa: BLE001
        logger.warning("snapshot read for interrupt flush failed: %s", e)
        return out
    for task in snap.tasks or []:
        for interrupt in (getattr(task, "interrupts", None) or ()):
            value = getattr(interrupt, "value", interrupt)
            interrupt_id = getattr(interrupt, "id", "") or ""
            tool = ""
            args: dict = {}
            allowed: list = []
            if isinstance(value, dict):
                action_requests = value.get("action_requests")
                review_configs = value.get("review_configs")
                if isinstance(action_requests, list) and action_requests:
                    first = action_requests[0]
                    if isinstance(first, dict):
                        tool = first.get("name", "") or ""
                        args = first.get("args", {}) or {}
                if isinstance(review_configs, list) and review_configs:
                    rc = review_configs[0]
                    if isinstance(rc, dict):
                        allowed = rc.get("allowed_decisions", []) or []
                if not tool:
                    tool = value.get("tool", "") or ""
                if not args:
                    args = value.get("args", {}) or {}
                if not allowed:
                    allowed = value.get("allowed_decisions", []) or []
            payload = {
                "id": interrupt_id,
                "tool": tool,
                "args": args,
                "allowed_decisions": allowed,
            }
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

    if event_name == "on_chain_end":
        output = ev.get("data", {}).get("output") or {}
        interrupts = output.get("__interrupt__") if isinstance(output, dict) else None
        if not interrupts:
            return None
        interrupt = interrupts[0]
        value = getattr(interrupt, "value", interrupt) if not isinstance(interrupt, dict) else interrupt
        interrupt_id = getattr(interrupt, "id", run_id)
        # langchain HumanInTheLoopMiddleware emits a HITLRequest:
        #   {"action_requests": [{"name", "args", "description"}, ...],
        #    "review_configs": [{"action_name", "allowed_decisions"}, ...]}
        # Older / hand-rolled callers may emit {"tool", "args", "allowed_decisions"}
        # directly — keep the legacy path so route tests stay valid.
        tool = ""
        args: dict = {}
        allowed: list = []
        if isinstance(value, dict):
            action_requests = value.get("action_requests")
            review_configs = value.get("review_configs")
            if isinstance(action_requests, list) and action_requests:
                first = action_requests[0]
                if isinstance(first, dict):
                    tool = first.get("name", "") or ""
                    args = first.get("args", {}) or {}
            if isinstance(review_configs, list) and review_configs:
                rc = review_configs[0]
                if isinstance(rc, dict):
                    allowed = rc.get("allowed_decisions", []) or []
            # Legacy/test shape fallback.
            if not tool:
                tool = value.get("tool", "") or ""
            if not args:
                args = value.get("args", {}) or {}
            if not allowed:
                allowed = value.get("allowed_decisions", []) or []
        return ("interrupt", {"id": interrupt_id, "tool": tool, "args": args, "allowed_decisions": allowed})

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

    # Phase 1.5.1: pdf_read_text may include server-side extraction progress
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
        f"- pdf_read_text(paper_id=\"{active_paper_id}\", page=N) for one page "
        f"(page is required);\n"
        f"- pdf_explain_passage(paper_id=\"{active_paper_id}\", page=N, "
        f"text=\"...\") to explain a selected passage;\n"
        f"- search_pdfs(query=\"...\") / list_pdfs() to find or list papers.\n"
        f"Use these names verbatim. Do NOT invent tools (e.g. read_pdf) and do "
        f"NOT call search_library — it is skill-gated and may be unavailable."
    )


def _build_configurable(
    *,
    thread_id: str,
    user_id: str,
    auth: dict,
    active_paper_id: str | None,
) -> dict:
    """Build the ``configurable`` dict for ``RunnableConfig``.

    Tools (read_paper, pdf_read_text, pdf_explain_passage) read
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
    ocr_key = auth.get("ocr_key") if isinstance(auth, dict) else None
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
    # so tools can default to the active resource and prepend a context line
    # to the user message so the model picks paper-scoped tools (read_paper /
    # pdf_read_text / pdf_explain_passage / search_pdfs / list_pdfs) — see
    # ``_build_reader_context_prefix`` for the exact tool list named to the LLM.
    page_context = body.get("page_context") or {}
    if not isinstance(page_context, dict):
        page_context = {}
    active_paper_id = page_context.get("paperId") if isinstance(page_context.get("paperId"), str) else None
    user_message = body["message"]
    if active_paper_id:
        user_message = (
            f"{_build_reader_context_prefix(active_paper_id)}\n\n"
            f"{user_message}"
        )

    async def gen():
        step = 0
        thread_id = body["thread_id"]
        configurable = _build_configurable(
            thread_id=thread_id,
            user_id=user_id,
            auth=auth,
            active_paper_id=active_paper_id,
        )
        try:
            async for ev in agent.astream_events(
                {"messages": [{"role": "user", "content": user_message}]},
                config={
                    "configurable": configurable,
                    "recursion_limit": _AGENT_RECURSION_LIMIT,
                },
                version="v2",
            ):
                if ev.get("event") == "on_chain_end":
                    step += 1
                    if step % _RECURSION_STEP_INTERVAL == 0:
                        logger.info(
                            "agent recursion step=%d thread_id=%s",
                            step, thread_id,
                        )
                        yield format_typed("recursion_step", {"step": step})
                mapped = _map_event(ev)
                if mapped:
                    yield format_typed(mapped[0], mapped[1])
                    for extra in _extra_events(ev, mapped):
                        yield format_typed(extra[0], extra[1])
            for ev_type, payload in _flush_pending_interrupts(agent, thread_id):
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
    # ``interrupt(...)["decisions"]`` — i.e. the resume value MUST be a dict
    # of shape ``{"decisions": [...]}``. The frontend posts the bare list,
    # so we wrap it here. Strip incidental keys (``tool_call_id``) the
    # middleware doesn't need; only ``type`` (+ optional ``message`` for
    # reject / ``edited_action`` for edit) is read.
    raw_decisions = body.get("decisions") or []
    decisions: list[dict] = []
    for d in raw_decisions:
        if not isinstance(d, dict):
            continue
        out: dict = {"type": d.get("type") or d.get("action") or "approve"}
        if "message" in d:
            out["message"] = d["message"]
        if "edited_action" in d:
            out["edited_action"] = d["edited_action"]
        decisions.append(out)
    resume_payload = {"decisions": decisions}

    async def gen():
        step = 0
        thread_id = body["thread_id"]
        configurable = _build_configurable(
            thread_id=thread_id,
            user_id=user_id,
            auth=auth,
            active_paper_id=None,
        )
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
                    if step % _RECURSION_STEP_INTERVAL == 0:
                        logger.info(
                            "agent recursion step=%d thread_id=%s",
                            step, thread_id,
                        )
                        yield format_typed("recursion_step", {"step": step})
                mapped = _map_event(ev)
                if mapped:
                    yield format_typed(mapped[0], mapped[1])
                    for extra in _extra_events(ev, mapped):
                        yield format_typed(extra[0], extra[1])
            for ev_type, payload in _flush_pending_interrupts(agent, thread_id):
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
    saver = get_saver()
    config = {"configurable": {"thread_id": thread_id}}
    tuple_ = await saver.aget_tuple(config)
    if tuple_ is None:
        return {"todos": [], "pending_interrupts": [], "messages": []}
    channel_values = tuple_.checkpoint.get("channel_values", {})
    todos = channel_values.get("todos", [])
    raw_messages = channel_values.get("messages", []) or []
    messages = _serialize_messages_with_tools(raw_messages)
    # pending_interrupts detail deferred to 1.3b
    return {
        "todos": todos,
        "pending_interrupts": [],
        "messages": messages,
    }


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

    async def run_cell(cell: dict) -> bool:
        row = cell["row_idx"]
        col = cell["col_name"]
        async with sem:
            await queue.put(("cell_started", {"row": row, "col": col}))
            paper_id = (row_refs[row] or {}).get("paper_id", "")
            description = col_by_name[col].get("description", "")
            prompt = (
                f"Fill cell (row={row}, col=\"{col}\") in paperset file_id={paperset_id}.\n"
                f"Target paper_id: {paper_id}\n"
                f"Column description (your extraction prompt): {description}\n"
                "Follow the data-extract skill rules: scope-first read, one-value, "
                "mandatory grounding, \"n/a\" for unanswered."
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
