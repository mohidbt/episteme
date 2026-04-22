import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from langchain_core.messages import AIMessageChunk
from langchain_openai import ChatOpenAI

from deps.auth import InternalAuthDep
from lib.chat import OPENROUTER_BASE, CHAT_MODEL

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents/km", tags=["km-complete"])


SYSTEM_PROMPT = (
    "You are a concise writing assistant embedded in a note editor. "
    "Follow the user's instruction. If context is provided, treat it as the "
    "surrounding text where your output will be inserted. Output only the "
    "requested content — no preambles, no meta-commentary."
)


class CompleteBody(BaseModel):
    prompt: str = Field(min_length=1)
    context: str | None = None


def _sse(obj) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _sse_done() -> str:
    return "data: [DONE]\n\n"


async def _stream_tokens(api_key: str, system: str, user: str) -> AsyncIterator[str]:
    model = ChatOpenAI(
        model=CHAT_MODEL,
        base_url=OPENROUTER_BASE,
        api_key=api_key,
        streaming=True,
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    async for chunk in model.astream(messages):
        if isinstance(chunk, AIMessageChunk) and isinstance(chunk.content, str) and chunk.content:
            yield chunk.content


@router.post("/complete")
async def complete(body: CompleteBody, auth: InternalAuthDep):
    api_key = auth["llm_key"]
    user_msg = (
        f"CONTEXT:\n{body.context}\n\nINSTRUCTION:\n{body.prompt}"
        if body.context
        else body.prompt
    )

    async def event_stream():
        try:
            async for tok in _stream_tokens(api_key, SYSTEM_PROMPT, user_msg):
                yield _sse({"type": "token", "content": tok})
        except Exception as e:  # noqa: BLE001
            logger.exception("km_complete upstream failed")
            yield _sse({"type": "error", "message": str(e)})
        yield _sse_done()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
