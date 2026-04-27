"""Scenario 4 — Guest user_id returns 403 from all /agents/km/* routes.

No LLM dependency. Runs without INHALE_LLM_KEY.
"""
from __future__ import annotations

import uuid

import pytest

from helpers.http import signed_get, signed_post


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
async def test_non_guest_invoke_not_403(http, agents_base, hmac_secret, test_user):
    """Smoke: a real user does NOT get 403 from the agent gating.

    Uses ``/agents/km/state/<thread_id>`` rather than ``/invoke`` so the test
    has no LLM dependency and is deterministic. The state route runs through
    the same ``_reject_guest`` gate as ``/invoke`` and ``/resume``, so a 200
    here proves the non-guest path is reachable. (The previous shape used
    ``signed_post`` against /invoke, which couldn't forward
    ``X-Inhale-LLM-Key`` and so errored mid-stream on the LLM call —
    §1.3b-E2E-5.)
    """
    resp = await signed_get(
        http,
        agents_base,
        f"/agents/km/state/{uuid.uuid4()}",
        user_id=test_user["user_id"],
        secret=hmac_secret,
    )
    assert resp.status_code != 403
    assert resp.status_code == 200
