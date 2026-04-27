"""Signed HTTP client mirroring services/agents/lib/km_http.py signer.

The signer must agree byte-for-byte with the inbound verifier in
apps/{km,reader}/src/lib/internal-auth.ts. The contract is locked by the
cross-language golden vector test in:
    services/agents/tests/test_auth.py
    apps/km/src/lib/internal-auth.test.ts
    apps/reader/src/lib/internal-auth.test.ts
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx


# Pinned model for E2E runs.
#
# The agents service default (config_cache._DEFAULTS["modelPreference"]) is a
# free Gemma model that aggressively rate-limits (429) under E2E load. We pin
# every LLM-driven test to a non-rate-limited free OpenRouter model that
# advertises tool-calling support. To swap models, change this single string.
#
# Verified on the OpenRouter catalog (2026-04-26): supported_parameters
# includes both "tools" and "tool_choice".
E2E_MODEL_ID = "nvidia/nemotron-3-super-120b-a12b:free"


def sign_request(
    *,
    secret: str,
    user_id: str,
    method: str,
    path_with_query: str,
    body_bytes: bytes = b"",
) -> dict[str, str]:
    """Return the X-Inhale-* headers expected by apps/km + apps/reader."""
    ts = str(int(time.time()))
    # Must match services/agents/deps/auth.py: ts + method + path + body (no delimiters)
    msg = ts.encode() + method.upper().encode() + path_with_query.encode() + body_bytes
    sig = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return {
        "X-Inhale-User-Id": user_id,
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
    }


async def signed_post(
    client: httpx.AsyncClient,
    base: str,
    path: str,
    *,
    user_id: str,
    secret: str,
    json_body: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> httpx.Response:
    body_bytes = json.dumps(json_body).encode() if json_body is not None else b""
    headers = {
        "Content-Type": "application/json",
        **sign_request(
            secret=secret,
            user_id=user_id,
            method="POST",
            path_with_query=path,
            body_bytes=body_bytes,
        ),
        **(extra_headers or {}),
    }
    return await client.post(f"{base}{path}", content=body_bytes, headers=headers)


async def signed_post_config(
    client: httpx.AsyncClient,
    base: str,
    *,
    user_id: str,
    secret: str,
    enabled_skills: list[str],
    model_id: str = E2E_MODEL_ID,
) -> httpx.Response:
    """POST /agents/km/config with both enabledSkills and modelPreference set.

    Pins the model so tests don't hit the rate-limited default. Note: the
    agents service replaces the entire config body on save, so callers who
    need approvalRules must pass them in via this helper's caller (none of
    the current E2E scenarios do — they rely on per-skill require_approval).
    """
    return await signed_post(
        client,
        base,
        "/agents/km/config",
        user_id=user_id,
        secret=secret,
        json_body={
            "enabledSkills": enabled_skills,
            "modelPreference": model_id,
        },
    )


async def signed_get(
    client: httpx.AsyncClient,
    base: str,
    path: str,
    *,
    user_id: str,
    secret: str,
) -> httpx.Response:
    headers = sign_request(
        secret=secret,
        user_id=user_id,
        method="GET",
        path_with_query=path,
    )
    return await client.get(f"{base}{path}", headers=headers)


async def signed_stream(
    client: httpx.AsyncClient,
    base: str,
    path: str,
    *,
    user_id: str,
    secret: str,
    json_body: dict[str, Any],
    llm_key: str | None = None,
):
    """Open an SSE stream against /agents/km/{invoke,resume}."""
    body_bytes = json.dumps(json_body).encode()
    headers = {
        "Content-Type": "application/json",
        **sign_request(
            secret=secret,
            user_id=user_id,
            method="POST",
            path_with_query=path,
            body_bytes=body_bytes,
        ),
    }
    if llm_key:
        headers["X-Inhale-LLM-Key"] = llm_key
    return client.stream("POST", f"{base}{path}", content=body_bytes, headers=headers)
