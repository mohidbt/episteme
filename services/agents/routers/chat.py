import asyncio
import json
import logging
from typing import Literal
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.auto_highlight_tools import TOOLBELT_SYSTEM_HINT, build_tools
from lib.conversations import upsert_conversation, insert_message, bump_updated_at
from lib.rag import retrieve
from lib.chat import CHAT_MODEL, run_chat
from routers.auto_highlight import progress_detail

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["chat"])


HIGHLIGHT_TOOL_LABELS = {
    "semantic_search": "Searching for passages\u2026",
    "page_text": "Reading page\u2026",
    "locate_phrase": "Locating phrase\u2026",
    "create_highlights": "Creating highlights\u2026",
    "finish": "Finishing up\u2026",
}


class ChatBody(BaseModel):
    question: str = Field(min_length=1)
    conversationId: int | None = None
    viewportContext: dict | None = None
    history: list[dict] = Field(default_factory=list)
    scope: Literal["page", "selection", "paper"] = "paper"
    selectionText: str | None = None
    pageNumber: int | None = None


def _sse(obj) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _sse_done() -> str:
    return "data: [DONE]\n\n"


async def _persist_turn(conn, *, conv_id, question, viewport, assistant_content):
    await insert_message(conn, conversation_id=conv_id, role="user", content=question, viewport=viewport)
    await insert_message(conn, conversation_id=conv_id, role="assistant", content=assistant_content)
    await bump_updated_at(conn, conv_id)


@router.post("/chat")
async def chat(body: ChatBody, auth: InternalAuthDep, conn: ConnDep):
    user_id = auth["user_id"]
    document_id = auth["document_id"]
    api_key = auth["llm_key"]

    if not document_id:
        raise HTTPException(status_code=400, detail="missing document_id")

    # Verify document exists + belongs to user
    doc = await conn.fetchrow(
        "SELECT id, processing_status, file_path FROM documents WHERE id = $1 AND user_id = $2",
        document_id, user_id,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")

    question = body.question.strip()
    scope = body.scope
    focus_page = body.pageNumber or (body.viewportContext or {}).get("page")
    selection_text = (body.selectionText or "").strip() or None

    # Processing status guard
    if doc["processing_status"] != "ready":
        status = doc["processing_status"]
        if status in ("pending", "processing"):
            msg = "This document is still being processed. Refresh in a minute and try again."
        elif status == "failed":
            msg = "This document failed to process. Please re-upload it."
        else:
            msg = "This document is not ready for chat yet."

        conv_id = await upsert_conversation(conn, user_id=user_id, document_id=document_id,
                                            conversation_id=body.conversationId, title=question)
        await _persist_turn(conn, conv_id=conv_id, question=question,
                           viewport=body.viewportContext, assistant_content=msg)

        async def status_stream():
            yield _sse({"type": "sources", "sources": [], "conversationId": conv_id})
            yield _sse({"type": "token", "content": msg})
            yield _sse_done()

        return StreamingResponse(status_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})

    # RAG retrieval
    retrieval = await retrieve(conn, document_id=document_id, question=question,
                               scope=scope, focus_page=focus_page,
                               selection_text=selection_text, api_key=api_key)

    # Empty-retrieval guard
    has_context = (
        len(retrieval.supporting_chunks) > 0
        or bool(retrieval.page_text)
        or bool(retrieval.anchor_text)
        or bool(selection_text)
    )

    if not has_context:
        empty_msg = "The assistant cannot find any content from this document. It may still be processing — try again in a minute, or re-upload."
        conv_id = await upsert_conversation(conn, user_id=user_id, document_id=document_id,
                                            conversation_id=body.conversationId, title=question)
        await _persist_turn(conn, conv_id=conv_id, question=question,
                           viewport=body.viewportContext, assistant_content=empty_msg)

        async def empty_stream():
            yield _sse({"type": "sources", "sources": [], "conversationId": conv_id})
            yield _sse({"type": "token", "content": empty_msg})
            yield _sse_done()

        return StreamingResponse(empty_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})

    # Main path: upsert conversation + persist user message
    conv_id = await upsert_conversation(conn, user_id=user_id, document_id=document_id,
                                        conversation_id=body.conversationId, title=question)
    await insert_message(conn, conversation_id=conv_id, role="user",
                        content=question, viewport=body.viewportContext)

    # Lazy highlight-run context: populated only if the agent calls create_highlights.
    hl_ctx: dict = {"run_id": None, "highlights_inserted": 0, "summary": None}

    pdf_path = doc["file_path"]

    # Shared lock serializes all conn usage across tools + router paths, since
    # OpenRouter may still emit parallel tool calls despite the kwarg hint and
    # asyncpg connections are NOT concurrent-safe.
    chat_conn_lock = asyncio.Lock()

    async def ensure_run_id() -> str:
        if hl_ctx["run_id"] is not None:
            return hl_ctx["run_id"]
        async with chat_conn_lock:
            row = await conn.fetchrow(
                "INSERT INTO ai_highlight_runs "
                "(document_id, user_id, instruction, status, conversation_id, model_used) "
                "VALUES ($1, $2, $3, 'running', $4, $5) RETURNING id",
                document_id, user_id, question, conv_id, CHAT_MODEL,
            )
        hl_ctx["run_id"] = str(row["id"])
        return hl_ctx["run_id"]

    highlight_tools = build_tools(
        conn, user_id, document_id, ensure_run_id, api_key, pdf_path,
        conn_lock=chat_conn_lock,
    )

    async def _mark_run_failed():
        if hl_ctx["run_id"] is None:
            return
        try:
            async with chat_conn_lock:
                await conn.execute(
                    "UPDATE ai_highlight_runs SET status = 'failed', completed_at = now() "
                    "WHERE id = $1::uuid",
                    hl_ctx["run_id"],
                )
        except Exception:
            logger.exception("failed to mark highlight run failed (best-effort)")

    async def _finalize_run_completed():
        if hl_ctx["run_id"] is None:
            return
        summary = hl_ctx["summary"] or f"Created {hl_ctx['highlights_inserted']} highlights."
        try:
            async with chat_conn_lock:
                await conn.execute(
                    "UPDATE ai_highlight_runs "
                    "SET status = 'completed', completed_at = now(), summary = $2 "
                    "WHERE id = $1::uuid",
                    hl_ctx["run_id"], summary,
                )
        except Exception:
            logger.exception("failed to finalize highlight run (best-effort)")

    async def event_stream():
        yield _sse({"type": "sources", "sources": retrieval.sources, "conversationId": conv_id})

        assistant_content = ""
        try:
            async for event in run_chat(
                api_key=api_key, history=body.history, question=question,
                supporting_chunks=retrieval.supporting_chunks,
                page_text=retrieval.page_text, anchor_text=retrieval.anchor_text,
                selection_text=selection_text, scope=scope, focus_page=focus_page,
                tools=highlight_tools,
                tool_hints=[TOOLBELT_SYSTEM_HINT],
            ):
                kind = event[0]
                print(f"[IMPLICIT-DEBUG] router received event kind={kind} payload={str(event[1])[:80]!r}", flush=True)
                if kind == "token":
                    token = event[1]
                    assistant_content += token
                    yield _sse({"type": "token", "content": token})
                elif kind == "tool_call":
                    name = event[1]
                    args = event[2] if len(event) > 2 else {}
                    if name in HIGHLIGHT_TOOL_LABELS:
                        detail = progress_detail(name, args if isinstance(args, dict) else {})
                        yield _sse({
                            "type": "highlight_progress",
                            "step": name,
                            "label": HIGHLIGHT_TOOL_LABELS[name],
                            "detail": detail,
                        })
                elif kind == "tool_result":
                    # event: ("tool_result", name, content)
                    name = event[1]
                    content = event[2]
                    if name == "create_highlights":
                        parsed = _try_parse(content)
                        if isinstance(parsed, dict):
                            hl_ctx["highlights_inserted"] += int(parsed.get("inserted", 0) or 0)
                    elif name == "finish":
                        parsed = _try_parse(content)
                        if isinstance(parsed, dict):
                            s = parsed.get("summary")
                            if s:
                                hl_ctx["summary"] = str(s)
        except asyncio.CancelledError:
            await _mark_run_failed()
            raise
        except Exception as e:  # noqa: BLE001
            await _mark_run_failed()
            yield _sse({"type": "error", "message": str(e)})
            yield _sse_done()
            return

        await _finalize_run_completed()

        if hl_ctx["run_id"] is not None:
            yield _sse({
                "type": "highlight_done",
                "runId": hl_ctx["run_id"],
                "count": hl_ctx["highlights_inserted"],
            })

        yield _sse_done()

        # Persist assistant turn after stream
        try:
            await insert_message(conn, conversation_id=conv_id, role="assistant", content=assistant_content)
            await bump_updated_at(conn, conv_id)
        except Exception:
            logger.exception("failed to persist assistant turn (best-effort)")

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})


def _try_parse(content):
    """Tool results may arrive as dict already or as JSON strings (ToolMessage.content)."""
    if isinstance(content, dict):
        return content
    if isinstance(content, str):
        try:
            return json.loads(content)
        except (ValueError, TypeError):
            return None
    return None
