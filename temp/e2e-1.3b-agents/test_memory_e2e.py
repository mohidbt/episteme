"""Scenario 7 — Cross-session memory.

Writes /memories/research-interests.md via one thread, reads back from a
second thread (same user). Optional: restart the agents service between
threads for a stronger guarantee. The restart path is left as TODO — see
README §Scenario 7 for the fallback approach.

Skips when INHALE_LLM_KEY unset.
"""
from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

from helpers.http import signed_post_config, signed_stream
from helpers.sse import collect_until_done, find_all


pytestmark = pytest.mark.asyncio


async def test_research_interests_persists_across_threads(
    http, agents_base, hmac_secret, llm_key, test_user
):
    if not llm_key:
        pytest.skip("INHALE_LLM_KEY not set — memory scenario needs LLM")

    user_id = test_user["user_id"]
    thread_a = str(uuid.uuid4())
    thread_b = str(uuid.uuid4())

    await signed_post_config(
        http,
        agents_base,
        user_id=user_id,
        secret=hmac_secret,
        enabled_skills=[],
    )

    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id=user_id,
        secret=hmac_secret,
        json_body={
            "thread_id": thread_a,
            "message": "Remember: my research interest is photonic computing.",
        },
        llm_key=llm_key,
    ) as resp:
        await collect_until_done(resp)

    conn = await asyncpg.connect(os.environ["EPISTEME_AGENTS_PG_URL"])
    try:
        row = await conn.fetchrow(
            "SELECT value FROM store WHERE prefix = $1 AND key = 'research-interests.md'",
            f"memories:{user_id}",
        )
    finally:
        await conn.close()
    assert row is not None, "research-interests.md not persisted to store"
    assert "photonic" in str(row["value"]).lower()

    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id=user_id,
        secret=hmac_secret,
        json_body={
            "thread_id": thread_b,
            "message": "What are my research interests?",
        },
        llm_key=llm_key,
    ) as resp:
        events = await collect_until_done(resp)

    text_chunks = "".join(e.get("delta", "") for e in find_all(events, "text"))
    assert "photonic" in text_chunks.lower(), \
        f"expected 'photonic' echoed back; got: {text_chunks[:200]}"
