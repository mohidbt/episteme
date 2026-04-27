"""Scenario 1 — /agent lit-triage HITL roundtrip.

Asserts the agent pauses on create_note, emits an interrupt, and the resume
flow lands a note row in the DB.

Skips when INHALE_LLM_KEY is unset (this scenario requires a live LLM).
"""
from __future__ import annotations

import re
import uuid

import pytest

from helpers.http import signed_post_config, signed_stream
from helpers.sse import collect_until_done, find_all, find_first


pytestmark = pytest.mark.asyncio


async def _set_research_interests(db_pool, user_id: str):
    """Seed the user's /memories/research-interests.md via the LangGraph store.

    The store is keyed under the agents service's PostgresStore. We write
    directly to the underlying table — confirm table name via:
        \\dt store_*
    in psql against $EPISTEME_AGENTS_PG_URL. Pseudo:
    """
    interests = "spiking neural networks, neuromorphic hardware"
    async with db_pool.acquire() as conn:
        # NOTE: schema-specific. AsyncPostgresStore uses a `store` table —
        # adjust namespace tuple per langgraph's PostgresStore conventions.
        await conn.execute(
            """
            INSERT INTO store (prefix, key, value)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (prefix, key) DO UPDATE SET value = EXCLUDED.value
            """,
            f"memories:{user_id}",
            "research-interests.md",
            f'"{interests}"',
        )


async def test_lit_triage_hitl_create_note_roundtrip(
    http, agents_base, hmac_secret, llm_key, db_pool, test_user
):
    if not llm_key:
        pytest.skip("INHALE_LLM_KEY not set — lit-triage scenario needs LLM")

    user_id = test_user["user_id"]
    thread_id = str(uuid.uuid4())

    await _set_research_interests(db_pool, user_id)

    cfg = await signed_post_config(
        http,
        agents_base,
        user_id=user_id,
        secret=hmac_secret,
        enabled_skills=["lit-triage"],
    )
    assert cfg.status_code == 200

    # ---- INVOKE ----
    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id=user_id,
        secret=hmac_secret,
        json_body={"thread_id": thread_id, "message": "Run lit-triage today"},
        llm_key=llm_key,
    ) as resp:
        assert resp.status_code == 200
        events = await collect_until_done(resp)

    interrupt = find_first(events, "interrupt")
    assert interrupt is not None, f"no interrupt; events: {[e for e, _ in events]}"
    assert interrupt["tool"] == "create_note"
    title = interrupt["args"].get("title", "")
    assert re.match(r"Inbox — \d{4}-\d{2}-\d{2}", title), f"unexpected title: {title!r}"

    # ---- RESUME ----
    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/resume",
        user_id=user_id,
        secret=hmac_secret,
        json_body={"thread_id": thread_id, "decisions": [{"approve": True}]},
        llm_key=llm_key,
    ) as resp:
        assert resp.status_code == 200
        resume_events = await collect_until_done(resp)

    tool_results = find_all(resume_events, "tool_result")
    create_note_results = [r for r in tool_results if r.get("state") == "output-available"]
    assert create_note_results, "no successful tool_result on resume"

    # ---- DB CHECK ----
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT title, content_md FROM notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
            user_id,
        )
    assert row is not None, "no note row created"
    assert "Inbox" in row["title"]
    body = row["content_md"]
    assert any(bucket in body for bucket in ("Must read", "Skim", "Skip")), \
        "expected bucket headers in body"
