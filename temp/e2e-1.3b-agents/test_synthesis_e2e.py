"""Scenario 3 — /agent synthesis drafts to /scratch with citations.

Asserts the agent reads multiple notes and writes a scratch markdown file
where every paragraph has at least one citation OR is marked ⚠ unsupported.

Skips when INHALE_LLM_KEY unset.
"""
from __future__ import annotations

import re
import uuid

import pytest

from helpers.http import signed_get, signed_post_config, signed_stream
from helpers.sse import collect_until_done, find_all


pytestmark = pytest.mark.asyncio


CITATION_RE = re.compile(r"\[\[[^\]]+\]\]|https?://\S+|⚠\s*unsupported", re.IGNORECASE)


async def _seed_notes(db_pool, user_id: str, library_id: str) -> list[str]:
    titles = [
        ("Note A — Hopfield networks", "Hopfield networks store patterns as energy minima."),
        ("Note B — sparse coding", "Sparse coding learns dictionaries that explain natural images."),
        ("Note C — predictive coding", "Predictive coding minimizes prediction error across cortical hierarchies."),
    ]
    ids: list[str] = []
    async with db_pool.acquire() as conn:
        for idx, (title, content) in enumerate(titles):
            note_id = str(uuid.uuid4())
            slug = f"e2e-synth-{idx}-{note_id[:8]}"
            await conn.execute(
                "INSERT INTO notes (id, user_id, library_id, title, slug, content_md) VALUES ($1, $2, $3, $4, $5, $6)",
                note_id,
                user_id,
                library_id,
                title,
                slug,
                content,
            )
            ids.append(note_id)
    return ids


async def test_synthesis_drafts_to_scratch_with_citations(
    http, agents_base, hmac_secret, llm_key, db_pool, test_user
):
    if not llm_key:
        pytest.skip("INHALE_LLM_KEY not set — synthesis scenario needs LLM")

    user_id = test_user["user_id"]
    library_id = test_user["library_id"]
    thread_id = str(uuid.uuid4())

    note_ids = await _seed_notes(db_pool, user_id, library_id)

    await signed_post_config(
        http,
        agents_base,
        user_id=user_id,
        secret=hmac_secret,
        enabled_skills=["synthesis"],
    )

    msg = f"Synthesize: predictive coding. Use note ids: {', '.join(note_ids)}"
    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id=user_id,
        secret=hmac_secret,
        json_body={"thread_id": thread_id, "message": msg},
        llm_key=llm_key,
    ) as resp:
        assert resp.status_code == 200
        events = await collect_until_done(resp)

    tool_calls = find_all(events, "tool_call")
    called = {tc.get("name") for tc in tool_calls}
    assert "search_notes" in called or "read_note" in called, \
        f"synthesizer must read notes; called: {called}"
    assert "create_note" not in called, \
        "synthesis drafts to /scratch first — must NOT call create_note in this run"

    write_calls = [tc for tc in tool_calls if tc.get("name") == "write_file"]
    assert write_calls, "synthesizer must write to /scratch via write_file"
    scratch_args = next((wc for wc in write_calls if "/scratch/" in str(wc.get("args", {}))), None)
    assert scratch_args, "no write_file call to /scratch/ path"

    state = await signed_get(
        http,
        agents_base,
        f"/agents/km/state/{thread_id}",
        user_id=user_id,
        secret=hmac_secret,
    )
    assert state.status_code == 200

    write_results = [
        r for ev, r in zip(
            (e for e, _ in events),
            (d for _, d in events),
        )
        if ev == "tool_result" and r.get("state") == "output-available"
    ]
    drafted_md = ""
    for tc in write_calls:
        body = tc.get("args", {}).get("contents") or tc.get("args", {}).get("content")
        if body:
            drafted_md = body
            break
    if drafted_md:
        paragraphs = [p.strip() for p in drafted_md.split("\n\n") if p.strip()]
        offenders = [p for p in paragraphs if not CITATION_RE.search(p)]
        assert not offenders, f"paragraphs without citation or ⚠ marker: {offenders[:2]}"
