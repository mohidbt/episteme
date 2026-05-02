import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from langchain_core.messages import AIMessageChunk
from langchain_openai import ChatOpenAI

from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.chat import OPENROUTER_BASE, CHAT_MODEL
from lib.openrouter_client import embed_texts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents/km", tags=["km-chat"])

SNIPPET_CHARS = 200
TOP_K = 6
SYSTEM_PROMPT = (
    "You answer questions about the user's personal knowledge base. "
    "You are given relevant passages from the user's notes as 'sources'. "
    "Cite every claim with [[NoteTitle]] references using the titles of the "
    "sources provided. If the sources don't contain the answer, say so — "
    "do not fabricate. Do not cite a note that isn't in the sources list."
)
EMPTY_REPLY = "I could not find anything in your notes about this topic."


class KmChatBody(BaseModel):
    question: str = Field(min_length=1)
    history: list[dict] = Field(default_factory=list)


def _sse(obj) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _sse_done() -> str:
    return "data: [DONE]\n\n"


async def _stream_tokens(api_key: str, messages: list[dict]) -> AsyncIterator[str]:
    model = ChatOpenAI(
        model=CHAT_MODEL,
        base_url=OPENROUTER_BASE,
        api_key=api_key,
        streaming=True,
    )
    async for chunk in model.astream(messages):
        if isinstance(chunk, AIMessageChunk) and isinstance(chunk.content, str) and chunk.content:
            yield chunk.content


async def _retrieve(conn, *, user_id: str, query_vec: list[float]) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT ne.note_id, ne.content, "
        "(1 - (ne.embedding <=> $2::vector)) AS score, "
        "n.title, n.slug "
        "FROM note_chunks ne "
        "JOIN notes n ON n.id = ne.note_id "
        "WHERE n.user_id = $1 AND ne.embedding IS NOT NULL "
        "ORDER BY score DESC LIMIT $3",
        user_id,
        query_vec,
        TOP_K,
    )
    by_note: dict[str, dict] = {}
    for r in rows:
        nid = str(r["note_id"])
        if nid in by_note:
            # rows are score-ordered DESC → first seen is best
            continue
        by_note[nid] = {
            "id": nid,
            "title": r["title"],
            "slug": r["slug"],
            "content": r["content"],
            "score": float(r["score"]),
        }
    return list(by_note.values())


@router.post("/chat")
async def chat(body: KmChatBody, auth: InternalAuthDep, conn: ConnDep):
    user_id = auth["user_id"]
    api_key = auth["llm_key"]

    vecs = await embed_texts(api_key, [body.question])
    query_vec = vecs[0]

    chunks = await _retrieve(conn, user_id=user_id, query_vec=query_vec)

    sources_payload = [
        {
            "id": c["id"],
            "title": c["title"],
            "slug": c["slug"],
            "snippet": c["content"][:SNIPPET_CHARS],
        }
        for c in chunks
    ]

    if not chunks:
        async def empty_stream():
            yield _sse({"type": "sources", "notes": []})
            yield _sse({"type": "token", "content": EMPTY_REPLY})
            yield _sse_done()

        return StreamingResponse(
            empty_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    context_block = "\n\n".join(
        f"--- Source: [[{c['title']}]] ---\n{c['content']}" for c in chunks
    )
    system = f"{SYSTEM_PROMPT}\n\n{context_block}"

    messages: list[dict] = [{"role": "system", "content": system}]
    messages.extend(body.history[-10:])
    messages.append({"role": "user", "content": body.question})

    async def event_stream():
        yield _sse({"type": "sources", "notes": sources_payload})
        try:
            async for tok in _stream_tokens(api_key, messages):
                yield _sse({"type": "token", "content": tok})
        except Exception as e:  # noqa: BLE001
            logger.exception("km_chat upstream failed")
            yield _sse({"type": "error", "message": str(e)})
        yield _sse_done()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
