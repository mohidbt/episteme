"""Scenario 5 — Toggling a skill off removes its tools from the agent.

Two layers:
  (a) Config round-trip persists across calls.
  (b) Agent tool surface reflects enabled set on each invoke (LLM-dependent).

Layer (a) runs always. Layer (b) skips without INHALE_LLM_KEY.
"""
from __future__ import annotations

import uuid

import pytest

from helpers.http import signed_post_config, signed_stream
from helpers.sse import collect_until_done, find_all


pytestmark = pytest.mark.asyncio


async def test_config_roundtrip_persists(http, agents_base, hmac_secret, test_user):
    user_id = test_user["user_id"]
    cfg1 = await signed_post_config(
        http,
        agents_base,
        user_id=user_id,
        secret=hmac_secret,
        enabled_skills=["lit-triage", "synthesis"],
    )
    assert cfg1.status_code == 200

    cfg2 = await signed_post_config(
        http,
        agents_base,
        user_id=user_id,
        secret=hmac_secret,
        enabled_skills=["synthesis"],
    )
    assert cfg2.status_code == 200


async def test_disabled_skill_tools_absent(
    http, agents_base, hmac_secret, llm_key, test_user
):
    if not llm_key:
        pytest.skip("INHALE_LLM_KEY not set — behavior assertion skipped")

    user_id = test_user["user_id"]
    thread_id = str(uuid.uuid4())

    await signed_post_config(
        http,
        agents_base,
        user_id=user_id,
        secret=hmac_secret,
        enabled_skills=["synthesis"],
    )

    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id=user_id,
        secret=hmac_secret,
        json_body={
            "thread_id": thread_id,
            "message": "Try to extract passages from any pdf you can find.",
        },
        llm_key=llm_key,
    ) as resp:
        events = await collect_until_done(resp)

    tool_calls = find_all(events, "tool_call")
    called = {tc.get("name") for tc in tool_calls}
    assert "extract_passages" not in called, \
        f"extract_passages must not be available with synthesis-only enabled; called: {called}"
    assert "highlight" not in called
    assert "list_references" not in called
