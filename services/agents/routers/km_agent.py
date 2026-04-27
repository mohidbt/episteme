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

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from deps.auth import InternalAuthDep
from km_agent import build_km_agent
from checkpointer import get_saver
from skills import load_skills
from store import get_store
from lib.config_cache import GUEST_USER_ID, load_user_config, save_user_config
from lib.openrouter_model import model_for
from lib.sse_events import _jsonable, format_sse, format_typed

# Per langgraph, ``recursion_limit`` bounds the number of super-steps a
# graph executes before raising ``GraphRecursionError``. Deep Agents with
# subagents need headroom; see module docstring.
_AGENT_RECURSION_LIMIT = 100

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
        tool = value.get("tool", "") if isinstance(value, dict) else ""
        args = value.get("args", {}) if isinstance(value, dict) else {}
        allowed = value.get("allowed_decisions", []) if isinstance(value, dict) else []
        return ("interrupt", {"id": interrupt_id, "tool": tool, "args": args, "allowed_decisions": allowed})

    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/invoke")
async def invoke(req: Request, auth: InternalAuthDep):
    _reject_guest(auth["user_id"])
    body = await req.json()
    user_id = auth["user_id"]
    cfg = load_user_config(user_id)
    agent = build_km_agent(
        user_id=user_id,
        thread_id=body["thread_id"],
        model=model_for(cfg["modelPreference"], auth["llm_key"]),
        enabled_skills=cfg.get("enabledSkills", []),
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
    )

    async def gen():
        async for ev in agent.astream_events(
            {"messages": [{"role": "user", "content": body["message"]}]},
            config={
                "configurable": {"thread_id": body["thread_id"]},
                "recursion_limit": _AGENT_RECURSION_LIMIT,
            },
            version="v2",
        ):
            mapped = _map_event(ev)
            if mapped:
                yield format_typed(mapped[0], mapped[1])
        yield format_sse("done", {"thread_id": body["thread_id"]})

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
    agent = build_km_agent(
        user_id=user_id,
        thread_id=body["thread_id"],
        model=model_for(cfg["modelPreference"], auth["llm_key"]),
        enabled_skills=cfg.get("enabledSkills", []),
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
    )

    async def gen():
        async for ev in agent.astream_events(
            Command(resume=body["decisions"]),
            config={
                "configurable": {"thread_id": body["thread_id"]},
                "recursion_limit": _AGENT_RECURSION_LIMIT,
            },
            version="v2",
        ):
            mapped = _map_event(ev)
            if mapped:
                yield format_typed(mapped[0], mapped[1])
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
    - Unknown name in `only` → 500 (load_skills raises KeyError)
    - Known names → list of {name, tools, subagents} per resolved spec
    """
    _reject_guest(auth["user_id"])
    try:
        specs = load_skills(only=only)
    except KeyError as exc:
        # load_skills raises KeyError on unknown names — surface as 500 so
        # the scalability gate fails loudly when a fixture isn't resolved
        # rather than masking it behind a 200.
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    return [
        {
            "name": s.name,
            "tools": list(s.tools),
            "subagents": list(s.subagents),
        }
        for s in specs
    ]
