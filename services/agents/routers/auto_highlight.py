import asyncio
import json
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain.agents import create_agent
from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.auto_highlight_tools import TOOLBELT_SYSTEM_HINT, build_tools
from lib.chat import CHAT_MODEL, OPENROUTER_BASE
from lib.conversations import bump_updated_at, insert_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["auto-highlight"])

AGENT_RECURSION_LIMIT = 25  # max tool-call depth before agent aborts
IDLE_TIMEOUT_S = 60  # max seconds between stream updates before we give up
TOTAL_TIMEOUT_S = 300  # hard wall-clock ceiling per run (5 minutes)

SYSTEM_PROMPT = (
    "You create highlights on a single PDF based on the user's instruction.\n"
    + TOOLBELT_SYSTEM_HINT
)


class AutoHighlightBody(BaseModel):
    instruction: str = Field(min_length=1)
    conversationId: int | None = None


def _sse(obj) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _sse_done() -> str:
    return "data: [DONE]\n\n"


async def _upsert_auto_highlight_conv(
    conn, *, user_id, document_id, conversation_id, title
):
    """Like upsert_conversation but forces kind='auto-highlight' on insert."""
    if conversation_id is not None:
        return conversation_id
    row = await conn.fetchrow(
        "INSERT INTO agent_conversations (user_id, document_id, title, kind) "
        "VALUES ($1, $2, $3, 'auto-highlight') RETURNING id",
        user_id,
        document_id,
        (title or "")[:80],
    )
    return row["id"]


@router.post("/auto-highlight")
async def auto_highlight(body: AutoHighlightBody, auth: InternalAuthDep, conn: ConnDep):
    user_id = auth["user_id"]
    document_id = auth["document_id"]
    api_key = auth["llm_key"]

    if not document_id:
        raise HTTPException(status_code=400, detail="missing document_id")

    doc = await conn.fetchrow(
        "SELECT id, file_path FROM documents WHERE id = $1 AND user_id = $2",
        document_id,
        user_id,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")

    instruction = body.instruction.strip()
    pdf_path = doc["file_path"]

    conv_id = await _upsert_auto_highlight_conv(
        conn,
        user_id=user_id,
        document_id=document_id,
        conversation_id=body.conversationId,
        title=instruction,
    )

    # Persist the user message up front (mirrors chat.py pattern)
    await insert_message(
        conn, conversation_id=conv_id, role="user", content=instruction
    )

    # Create the run row; its id is the layer_id highlights will be tagged with.
    run_row = await conn.fetchrow(
        "INSERT INTO ai_highlight_runs "
        "(document_id, user_id, instruction, status, conversation_id) "
        "VALUES ($1, $2, $3, 'running', $4) RETURNING id",
        document_id,
        user_id,
        instruction,
        conv_id,
    )
    run_id = str(run_row["id"])

    model = ChatOpenAI(
        model=CHAT_MODEL, base_url=OPENROUTER_BASE, api_key=api_key, streaming=False
    )
    async def _get_run_id() -> str:
        return run_id

    conn_lock = asyncio.Lock()
    tools = build_tools(
        conn, user_id, document_id, _get_run_id, api_key, pdf_path,
        conn_lock=conn_lock,
    )
    agent = create_agent(model=model, tools=tools, system_prompt=SYSTEM_PROMPT)

    async def event_stream():
        yield _sse({"type": "run", "runId": run_id, "conversationId": conv_id})

        summary = ""
        error_msg: str | None = None
        iterator = agent.astream(
            {"messages": [{"role": "user", "content": instruction}]},
            config={"recursion_limit": AGENT_RECURSION_LIMIT},
            stream_mode="updates",
        ).__aiter__()
        start = time.monotonic()
        try:
            while True:
                remaining = TOTAL_TIMEOUT_S - (time.monotonic() - start)
                if remaining <= 0:
                    error_msg = (
                        f"agent exceeded {TOTAL_TIMEOUT_S}s wall-clock limit"
                    )
                    break
                step_timeout = min(IDLE_TIMEOUT_S, remaining)
                try:
                    update = await asyncio.wait_for(
                        iterator.__anext__(), timeout=step_timeout
                    )
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError:
                    if time.monotonic() - start >= TOTAL_TIMEOUT_S:
                        error_msg = (
                            f"agent exceeded {TOTAL_TIMEOUT_S}s wall-clock limit"
                        )
                    else:
                        error_msg = "timed out waiting for agent"
                    break

                # update shape: {"<node_name>": {"messages": [...], ...}}
                for node_name, node_state in update.items():
                    if node_name != "model":
                        continue
                    msgs = (node_state or {}).get("messages", []) or []
                    for m in msgs:
                        if not isinstance(m, AIMessage):
                            continue
                        for tc in m.tool_calls or []:
                            name = tc.get("name", "tool")
                            args = tc.get("args") or {}
                            detail = progress_detail(name, args)
                            yield _sse(
                                {"type": "progress", "step": name, "detail": detail}
                            )
                            if name == "finish":
                                summary = str(args.get("summary", "")) or summary
        except asyncio.CancelledError:
            # Browser disconnect: cancel the underlying agent generator, mark row
            # failed (best-effort), then re-raise so FastAPI tears down cleanly.
            try:
                await iterator.aclose()
            except Exception:
                logger.exception("failed to close agent iterator on cancel")
            try:
                async with conn_lock:
                    await conn.execute(
                        "UPDATE ai_highlight_runs SET status = 'failed', completed_at = now() "
                        "WHERE id = $1::uuid",
                        run_id,
                    )
            except Exception:
                logger.exception("failed to mark highlight run failed (best-effort)")
            raise
        except Exception as e:  # noqa: BLE001
            error_msg = str(e)

        # Timeout path: ensure the agent coroutine is actually cancelled, not
        # left pinning a worker. aclose() drives CancelledError into the
        # generator's current await point.
        if error_msg is not None:
            try:
                await iterator.aclose()
            except Exception:
                logger.exception("failed to close agent iterator after timeout")

        async with conn_lock:
            highlights_count = int(
                await conn.fetchval(
                    "SELECT COUNT(*) FROM user_highlights WHERE layer_id = $1::uuid",
                    run_id,
                )
                or 0
            )

        if error_msg is not None:
            yield _sse({"type": "error", "message": error_msg})
            async with conn_lock:
                await conn.execute(
                    "UPDATE ai_highlight_runs SET status = 'failed', completed_at = now() "
                    "WHERE id = $1::uuid",
                    run_id,
                )
        else:
            async with conn_lock:
                await conn.execute(
                    "UPDATE ai_highlight_runs "
                    "SET status = 'completed', completed_at = now(), "
                    "summary = $2, model_used = $3 "
                    "WHERE id = $1::uuid",
                    run_id,
                    summary or None,
                    CHAT_MODEL,
                )
            yield _sse(
                {
                    "type": "done",
                    "summary": summary,
                    "highlightsCount": highlights_count,
                }
            )

        # Persist assistant message + bump conversation
        assistant_content = summary if error_msg is None else f"Error: {error_msg}"
        try:
            await insert_message(
                conn,
                conversation_id=conv_id,
                role="assistant",
                content=assistant_content,
            )
            await bump_updated_at(conn, conv_id)
        except Exception:
            pass

        yield _sse_done()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


def progress_detail(name: str, args: dict) -> str:
    if name == "semantic_search":
        q = args.get("query", "")
        return f"searching: {q[:60]}" if q else "searching"
    if name == "page_text":
        return f"reading page {args.get('page_number', '?')}"
    if name == "locate_phrase":
        p = args.get("phrase", "")
        return f"locating on page {args.get('page_number', '?')}: {p[:40]}"
    if name == "create_highlights":
        n = len(args.get("matches") or [])
        return f"creating {n} highlight(s)"
    if name == "finish":
        return "finishing"
    return name


# Back-compat alias for existing tests.
_progress_detail = progress_detail
