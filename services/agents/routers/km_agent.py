"""KM Agent routes — /agents/km/{invoke,resume,state,config}.

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
    if ev.get("name") != "write_todos":
        return []
    output = mapped[1].get("output")
    if not isinstance(output, dict):
        return []
    update = output.get("update")
    items = update.get("todos") if isinstance(update, dict) else None
    if not isinstance(items, list):
        return []
    # Upstream Todo schema (langchain.agents.middleware.todo) has only
    # `content` + `status`; no stable id. Inject a deterministic positional
    # id so the React keys are always present (warning at AgentTranscript:264).
    enriched: list = []
    for idx, item in enumerate(items):
        if isinstance(item, dict) and "id" not in item:
            enriched.append({**item, "id": f"todo-{idx}"})
        else:
            enriched.append(item)
    return [("todos", {"items": enriched})]


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
    agent = await build_km_agent(
        user_id=user_id,
        thread_id=body["thread_id"],
        model=model_for(model_pref, auth["llm_key"]),
        enabled_skills=enabled,
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
    )

    async def gen():
        step = 0
        thread_id = body["thread_id"]
        try:
            async for ev in agent.astream_events(
                {"messages": [{"role": "user", "content": body["message"]}]},
                config={
                    "configurable": {"thread_id": thread_id, "user_id": user_id},
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
    agent = await build_km_agent(
        user_id=user_id,
        thread_id=body["thread_id"],
        model=model_for(model_pref, auth["llm_key"]),
        enabled_skills=enabled,
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
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
        try:
            async for ev in agent.astream_events(
                Command(resume=resume_payload),
                config={
                    "configurable": {"thread_id": thread_id, "user_id": user_id},
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


@router.get("/state/{thread_id}")
async def state(thread_id: str, auth: InternalAuthDep):
    _reject_guest(auth["user_id"])
    saver = get_saver()
    config = {"configurable": {"thread_id": thread_id}}
    tuple_ = await saver.aget_tuple(config)
    if tuple_ is None:
        return {"todos": [], "pending_interrupts": []}
    channel_values = tuple_.checkpoint.get("channel_values", {})
    todos = channel_values.get("todos", [])
    # pending_interrupts detail deferred to 1.3b
    return {"todos": todos, "pending_interrupts": []}


@router.post("/config")
async def config_post(req: Request, auth: InternalAuthDep):
    _reject_guest(auth["user_id"])
    body = await req.json()
    save_user_config(auth["user_id"], body)
    return {"ok": True}


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
