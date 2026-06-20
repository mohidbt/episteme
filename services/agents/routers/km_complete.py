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
from lib.openrouter_client import _maybe_raise_trial_exhausted

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents/km", tags=["km-complete"])


GENERATE_SYSTEM = "You assist scientists in their writing notes."
REPHRASE_SYSTEM = "You rephrase text. Output only the rewritten version."


class CompleteBody(BaseModel):
    prompt: str = Field(min_length=1)
    context: str | None = None
    mode: str | None = None  # "rephrase" | "generate"


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
    system = REPHRASE_SYSTEM if body.mode == "rephrase" else GENERATE_SYSTEM

    # GSD-136: prime the OR call by reading the first chunk BEFORE opening
    # the SSE response. If OR's bucket is exhausted (401 with quota hint, or
    # 402), this raises OpenRouterTrialExhausted; the global app handler
    # converts that to HTTP 402 so KM-side stream-passthrough emits the
    # stable trial_exhausted code. Without this priming, the exception
    # would fire inside event_stream after headers are already flushed.
    iterator = _stream_tokens(api_key, system, user_msg).__aiter__()
    try:
        first_tok = await iterator.__anext__()
        primed_value: str | None = first_tok
    except StopAsyncIteration:
        primed_value = None
    except Exception as exc:  # noqa: BLE001
        status = getattr(exc, "status_code", None) or getattr(
            getattr(exc, "response", None), "status_code", None
        )
        if isinstance(status, int):
            _maybe_raise_trial_exhausted(status, str(exc))
        raise

    async def event_stream():
        try:
            if primed_value is not None:
                yield _sse({"type": "token", "content": primed_value})
            async for tok in iterator:
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
