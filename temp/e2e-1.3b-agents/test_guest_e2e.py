"""Scenario 4 — Guest user_id returns 403 from all /agents/km/* routes.

No LLM dependency. Runs without INHALE_LLM_KEY.
"""
from __future__ import annotations

import uuid

import pytest

from helpers.http import signed_get, signed_post, signed_post_config


@pytest.mark.asyncio
async def test_guest_invoke_403(http, agents_base, hmac_secret):
    resp = await signed_post(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id="guest",
        secret=hmac_secret,
        json_body={"thread_id": str(uuid.uuid4()), "message": "hello"},
    )
    assert resp.status_code == 403
    body = resp.json()
    detail = body.get("detail", body)
    assert detail.get("code") == "guest_forbidden"


@pytest.mark.asyncio
async def test_guest_resume_403(http, agents_base, hmac_secret):
    resp = await signed_post(
        http,
        agents_base,
        "/agents/km/resume",
        user_id="guest",
        secret=hmac_secret,
        json_body={"thread_id": str(uuid.uuid4()), "decisions": [{"approve": True}]},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_guest_state_403(http, agents_base, hmac_secret):
    resp = await signed_get(
        http,
        agents_base,
        f"/agents/km/state/{uuid.uuid4()}",
        user_id="guest",
        secret=hmac_secret,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_guest_config_403(http, agents_base, hmac_secret):
    resp = await signed_post(
        http,
        agents_base,
        "/agents/km/config",
        user_id="guest",
        secret=hmac_secret,
        json_body={"enabledSkills": []},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_non_guest_invoke_not_403(http, agents_base, hmac_secret, test_user, llm_key):
    """Smoke: a real user does NOT get 403 (regression for guest gating).

    Skips when no LLM key — without one the stream errors mid-flight at the
    LLM call, which we don't want to assert against here.
    """
    if not llm_key:
        pytest.skip("INHALE_LLM_KEY not set — non-guest smoke skipped")
    # Pin the non-rate-limited model so the SSE stream doesn't 429 mid-flight
    # on the global default. We only assert status_code != 403, but the
    # non-guest path opens the stream and starts an LLM call.
    await signed_post_config(
        http,
        agents_base,
        user_id=test_user["user_id"],
        secret=hmac_secret,
        enabled_skills=[],
    )
    resp = await signed_post(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id=test_user["user_id"],
        secret=hmac_secret,
        json_body={"thread_id": str(uuid.uuid4()), "message": "hi"},
    )
    # The non-guest path opens the SSE stream — anything other than 403 is fine.
    assert resp.status_code != 403
