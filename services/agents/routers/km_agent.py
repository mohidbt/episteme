"""KM Agent routes — /agents/km/{invoke,resume,state,config}.

SSE library: StreamingResponse (consistent with existing km_complete.py).
Event format: event: <type>\ndata: <json>\n\n  (typed SSE per format_sse helper).
"""
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from deps.auth import InternalAuthDep
from km_agent import build_km_agent
from checkpointer import get_saver
from store import get_store
from lib.config_cache import load_user_config, save_user_config
from lib.openrouter_model import model_for
from lib.sse_events import format_sse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agents/km", tags=["km-agent"])


# ---------------------------------------------------------------------------
# Event mapping
# ---------------------------------------------------------------------------

def _map_event(ev: dict) -> dict | None:
    """Map an astream_events v2 event to a typed SSE event dict.

    Covered in 1.3a:
    - on_chat_model_stream  → text   {delta}
    - on_tool_start         → tool_call  {id, name, args, state}
    - on_tool_end           → tool_result {id, name, output, state}
    - on_chain_end with __interrupt__ in output → interrupt {id, tool, args, allowed_decisions}
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
        return {"event": "text", "data": {"id": run_id, "delta": content}}

    if event_name == "on_tool_start":
        name = ev.get("name", "tool")
        args = ev.get("data", {}).get("input") or {}
        return {
            "event": "tool_call",
            "data": {"id": run_id, "name": name, "args": args, "state": "input-available"},
        }

    if event_name == "on_tool_end":
        name = ev.get("name", "tool")
        raw_output = ev.get("data", {}).get("output")
        output = getattr(raw_output, "content", raw_output) if raw_output is not None else None
        state = "output-available"
        if isinstance(raw_output, Exception):
            state = "output-error"
        return {
            "event": "tool_result",
            "data": {"id": run_id, "name": name, "output": output, "state": state},
        }

    if event_name == "on_chain_end":
        output = ev.get("data", {}).get("output") or {}
        interrupts = output.get("__interrupt__") if isinstance(output, dict) else None
        if not interrupts:
            return None
        # Emit one interrupt event per interrupt value
        interrupt = interrupts[0]
        value = getattr(interrupt, "value", interrupt) if not isinstance(interrupt, dict) else interrupt
        interrupt_id = getattr(interrupt, "id", run_id)
        return {
            "event": "interrupt",
            "data": {
                "id": interrupt_id,
                "value": value,
            },
        }

    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/invoke")
async def invoke(req: Request, auth: InternalAuthDep):
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
        try:
            async for ev in agent.astream_events(
                {"messages": [{"role": "user", "content": body["message"]}]},
                config={"configurable": {"thread_id": body["thread_id"]}},
                version="v2",
            ):
                mapped = _map_event(ev)
                if mapped:
                    yield format_sse(mapped["event"], mapped["data"])
            yield format_sse("done", {"thread_id": body["thread_id"]})
        except Exception as e:  # noqa: BLE001
            logger.exception("invoke failed")
            yield format_sse("error", {"message": str(e)})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/resume")
async def resume(req: Request, auth: InternalAuthDep):
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
        try:
            async for ev in agent.astream_events(
                Command(resume=body["decisions"]),
                config={"configurable": {"thread_id": body["thread_id"]}},
                version="v2",
            ):
                mapped = _map_event(ev)
                if mapped:
                    yield format_sse(mapped["event"], mapped["data"])
            yield format_sse("done", {"thread_id": body["thread_id"]})
        except Exception as e:  # noqa: BLE001
            logger.exception("resume failed")
            yield format_sse("error", {"message": str(e)})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/state/{thread_id}")
async def state(thread_id: str, auth: InternalAuthDep):
    user_id = auth["user_id"]
    cfg = load_user_config(user_id)
    agent = build_km_agent(
        user_id=user_id,
        thread_id=thread_id,
        model=model_for(cfg["modelPreference"], auth["llm_key"]),
        enabled_skills=cfg.get("enabledSkills", []),
        approval_rules=cfg.get("approvalRules", {}),
        store=get_store(),
        saver=get_saver(),
    )
    snapshot = agent.get_state(config={"configurable": {"thread_id": thread_id}})
    return {
        "todos": snapshot.values.get("todos", []),
        "pending_interrupts": [
            {"id": t.id, "interrupts": [i.value for i in t.interrupts]}
            for t in snapshot.tasks
            if t.interrupts
        ],
    }


@router.post("/config")
async def config_post(req: Request, auth: InternalAuthDep):
    body = await req.json()
    save_user_config(auth["user_id"], body)
    return {"ok": True}
