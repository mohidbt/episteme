import os
import httpx
from langchain_openai import ChatOpenAI

EMBED_MODEL = "openai/text-embedding-3-small"
EMBED_URL = "https://openrouter.ai/api/v1/embeddings"
EMBED_DIM = 1536

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
CHAT_MODEL = "openai/gpt-5.4-nano"


class OpenRouterTrialExhausted(Exception):
    """Raised when an OR call returns 401/402/403 with a quota hint.

    GSD-136: OR returns HTTP 401 (NOT 402) when a Provisioning-API key has
    its `limit` exhausted. Routers must catch this BEFORE the first SSE
    yield and convert to `HTTPException(status_code=402)` so the KM-side
    stream-passthrough maps it to the stable `trial_exhausted` JSON code.
    """


def _maybe_raise_trial_exhausted(status_code: int, body_text: str) -> None:
    # Import locally so this module stays import-cycle-free.
    from lib.key_health import classify_provider_error  # noqa: PLC0415

    if classify_provider_error(status_code, body_text) == "key_exhausted":
        raise OpenRouterTrialExhausted()


def _fallback_env_var(api_key: str) -> str | None:
    """Return the env var name iff `api_key` came from one of the known
    OpenRouter fallback envs. Used to scope key-exhaustion alerts to global
    (operator-owned) keys only, ignoring per-user BYOK failures."""
    if not api_key:
        return None
    shared = os.environ.get("EPISTEME_SHARED_LLM_KEY", "").strip()
    if shared and api_key == shared:
        return "EPISTEME_SHARED_LLM_KEY"
    server = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if server and api_key == server:
        return "OPENROUTER_API_KEY"
    return None


async def _notify_if_fallback(api_key: str, status_code: int, body_text: str) -> None:
    env_var = _fallback_env_var(api_key)
    if env_var is None:
        return
    from lib.key_health import (  # noqa: PLC0415 — avoid import cycles at boot
        classify_provider_error,
        record_and_maybe_alert,
    )
    from deps import db as db_module  # noqa: PLC0415

    reason = classify_provider_error(status_code, body_text)
    if reason is None:
        return
    await record_and_maybe_alert(
        db_module._pool,
        provider="openrouter",
        env_var=env_var,
        reason=reason,
        sample_error=body_text[:1000] if body_text else None,
    )


async def call_model(
    api_key: str,
    system: str,
    user_content: str,
    model: str | None = None,
) -> str:
    """Non-streaming model call. Returns full text response."""
    chat = ChatOpenAI(
        model=model or CHAT_MODEL,
        base_url=OPENROUTER_BASE,
        api_key=api_key,
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    try:
        response = await chat.ainvoke(messages)
    except Exception as exc:
        status = getattr(exc, "status_code", None) or getattr(
            getattr(exc, "response", None), "status_code", None
        )
        if isinstance(status, int):
            body_text = str(exc)
            await _notify_if_fallback(api_key, status, body_text)
            # GSD-136: classify upstream OR errors so callers can render the
            # trial-exhausted UX. str(exc) carries the JSON body for
            # langchain/openai exceptions, which is what the classifier needs
            # to match the quota-hint strings.
            _maybe_raise_trial_exhausted(status, body_text)
        raise
    return response.content


async def embed_texts(api_key: str, inputs: list[str]) -> list[list[float]]:
    if not inputs:
        return []
    if os.environ.get("INHALE_STUB_EMBEDDINGS") == "1":
        return [[0.01] * EMBED_DIM for _ in inputs]
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            EMBED_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": EMBED_MODEL, "input": inputs},
        )
        if r.status_code >= 400:
            await _notify_if_fallback(api_key, r.status_code, r.text)
            # GSD-136: surface trial-exhausted before httpx raises so the
            # caller's HTTPException(402) wrapper has a typed exception to
            # bind on (rather than an opaque HTTPStatusError).
            _maybe_raise_trial_exhausted(r.status_code, r.text)
        r.raise_for_status()
        data = r.json()["data"]
        return [d["embedding"] for d in data]
