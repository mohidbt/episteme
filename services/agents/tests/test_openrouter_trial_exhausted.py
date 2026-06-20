"""GSD-136 — OpenRouter trial-exhausted classification on the sidecar.

OR returns HTTP 401 (NOT 402) when a Provisioning-API-created key has its
`limit` exhausted. The body carries a "more credits" quota hint. The
sidecar's openrouter_client must raise OpenRouterTrialExhausted on this
case so streaming routers can convert it to HTTPException(402) BEFORE the
first SSE yield.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.openrouter_client import (  # noqa: E402
    OpenRouterTrialExhausted,
    _maybe_raise_trial_exhausted,
    embed_texts,
)


def test_maybe_raise_trial_exhausted_401_with_quota_hint():
    body = (
        '{"error":{"code":401,"message":"This request requires more credits, '
        'or fewer max_tokens."}}'
    )
    with pytest.raises(OpenRouterTrialExhausted):
        _maybe_raise_trial_exhausted(401, body)


def test_maybe_raise_trial_exhausted_402_legacy():
    with pytest.raises(OpenRouterTrialExhausted):
        _maybe_raise_trial_exhausted(402, "payment required")


def test_maybe_raise_trial_exhausted_401_without_quota_hint_does_not_raise():
    # Real auth failure — must NOT classify as trial-exhausted.
    _maybe_raise_trial_exhausted(401, '{"error":{"message":"No auth credentials"}}')
    _maybe_raise_trial_exhausted(401, "")


def test_maybe_raise_trial_exhausted_200_does_not_raise():
    _maybe_raise_trial_exhausted(200, "")


def test_maybe_raise_trial_exhausted_500_does_not_raise():
    _maybe_raise_trial_exhausted(500, "internal error")


def _fake_response(status: int, text: str) -> httpx.Response:
    return httpx.Response(
        status,
        text=text,
        request=httpx.Request("POST", "https://openrouter.ai/api/v1/embeddings"),
    )


@pytest.mark.asyncio
async def test_embed_texts_raises_trial_exhausted_on_401_quota(monkeypatch):
    """embed_texts must surface OpenRouterTrialExhausted (not bare httpx error)
    when OR's embeddings endpoint returns 401-with-quota-hint, so the caller
    can map to HTTP 402."""

    # Defensive: other test modules set INHALE_STUB_EMBEDDINGS=1 at import
    # time which would short-circuit embed_texts before it ever hits httpx.
    monkeypatch.delenv("INHALE_STUB_EMBEDDINGS", raising=False)

    body = (
        '{"error":{"code":401,"message":"This request requires more credits"}}'
    )

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return None

        async def post(self, *_args, **_kwargs):
            return _fake_response(401, body)

    monkeypatch.setattr(
        "lib.openrouter_client.httpx.AsyncClient",
        lambda *_a, **_kw: FakeClient(),
    )

    with pytest.raises(OpenRouterTrialExhausted):
        await embed_texts("sk-managed", ["hello"])


@pytest.mark.asyncio
async def test_embed_texts_passes_through_real_401(monkeypatch):
    """A real auth failure (no quota hint) must NOT raise TrialExhausted;
    httpx's HTTPStatusError surfaces instead so the key-invalid path runs."""

    monkeypatch.delenv("INHALE_STUB_EMBEDDINGS", raising=False)

    body = '{"error":{"message":"No auth credentials"}}'

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return None

        async def post(self, *_args, **_kwargs):
            return _fake_response(401, body)

    monkeypatch.setattr(
        "lib.openrouter_client.httpx.AsyncClient",
        lambda *_a, **_kw: FakeClient(),
    )

    with pytest.raises(httpx.HTTPStatusError):
        await embed_texts("sk-bad", ["hello"])
