"""Scenario 2 — /agent deep-read on a seeded PDF.

Asserts the agent calls extract_passages, pauses on highlight (HITL per
SKILL.md frontmatter require_approval: [highlight]), then produces a summary
note with [[pdf:<id>#p<N>]] anchors.

Skips when INHALE_LLM_KEY unset OR when sample PDF fixture cannot be prepared.
"""
from __future__ import annotations

import os
import pathlib
import re
import uuid

import pytest

from helpers.http import signed_post_config, signed_stream
from helpers.sse import collect_until_done, find_all, find_first


pytestmark = pytest.mark.asyncio


PDF_ANCHOR_RE = re.compile(r"\[\[pdf:[a-f0-9-]+#p\d+\]\]", re.IGNORECASE)


def _fixture_pdf_path() -> pathlib.Path | None:
    p = pathlib.Path(__file__).parent / "fixtures" / "sample.pdf"
    return p if p.exists() else None


async def _seed_pdf(db_pool, user_id: str, library_id: str, pdf_path: pathlib.Path) -> str:
    """Insert documents row + place file in MinIO (left as TODO — adapt to project's reader pipeline).

    Returns the document UUID.
    """
    doc_id = str(uuid.uuid4())
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO documents (id, user_id, library_id, title, file_path)
            VALUES ($1, $2, $3, $4, $5)
            """,
            doc_id,
            user_id,
            library_id,
            "Sample PDF",
            f"pdfs/{doc_id}/source.pdf",
        )
    return doc_id


async def test_deep_read_pdf_to_summary_note(
    http, agents_base, hmac_secret, llm_key, db_pool, test_user
):
    if not llm_key:
        pytest.skip("INHALE_LLM_KEY not set — deep-read needs LLM")
    pdf = _fixture_pdf_path()
    if pdf is None:
        pytest.skip("temp/e2e-1.3b-agents/fixtures/sample.pdf missing")

    user_id = test_user["user_id"]
    library_id = test_user["library_id"]
    thread_id = str(uuid.uuid4())

    doc_id = await _seed_pdf(db_pool, user_id, library_id, pdf)

    await signed_post_config(
        http,
        agents_base,
        user_id=user_id,
        secret=hmac_secret,
        enabled_skills=["deep-read"],
    )

    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/invoke",
        user_id=user_id,
        secret=hmac_secret,
        json_body={"thread_id": thread_id, "message": f"Deep read pdf {doc_id}"},
        llm_key=llm_key,
    ) as resp:
        assert resp.status_code == 200
        events = await collect_until_done(resp)

    tool_calls = find_all(events, "tool_call")
    called = {tc.get("name") for tc in tool_calls}
    assert "extract_passages" in called, f"missing extract_passages; called: {called}"

    interrupt = find_first(events, "interrupt")
    assert interrupt is not None and interrupt["tool"] == "highlight", \
        "expected HITL interrupt on highlight"

    async with await signed_stream(
        http,
        agents_base,
        "/agents/km/resume",
        user_id=user_id,
        secret=hmac_secret,
        json_body={"thread_id": thread_id, "decisions": [{"approve": True}]},
        llm_key=llm_key,
    ) as resp:
        resume_events = await collect_until_done(resp)

    resume_calls = find_all(resume_events, "tool_call")
    assert any(tc.get("name") == "highlight" for tc in resume_calls)

    async with db_pool.acquire() as conn:
        note_row = await conn.fetchrow(
            "SELECT content_md FROM notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
            user_id,
        )
        hl_count = await conn.fetchval(
            "SELECT count(*) FROM user_highlights WHERE document_id = $1",
            doc_id,
        )

    assert note_row, "no summary note created"
    assert PDF_ANCHOR_RE.search(note_row["content_md"]), \
        f"expected [[pdf:{doc_id}#pN]] anchors; got: {note_row['content_md'][:200]}"
    assert hl_count > 0, "expected highlight rows after approve+resume"
