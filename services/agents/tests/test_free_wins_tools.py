"""GSD-53: pdf_read_tables + diff_revision wired into TOOLS.

pdf_read_tables — convenience wrapper around read_paper with
``scope={"kind":"blocks","types":["table"]}``.

diff_revision — wraps GET /api/notes/{id}/revisions/{rev} for two revisions
and returns both contents so the LLM can diff them. (No server-side diff
route exists; client-side diff in the agent loop is fine for "show me what
changed" intents.)
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


def test_pdf_read_tables_in_pdfs_TOOLS():
    from tools.pdfs import TOOLS, pdf_read_tables

    assert pdf_read_tables in TOOLS


def test_pdf_read_tables_in_ALL_TOOLS():
    from tools import ALL_TOOLS

    names = {t.name for t in ALL_TOOLS}
    assert "pdf_read_tables" in names


def test_diff_revision_in_revisions_TOOLS():
    from tools.revisions import TOOLS, diff_revision

    assert diff_revision in TOOLS


def test_diff_revision_in_ALL_TOOLS():
    from tools import ALL_TOOLS

    names = {t.name for t in ALL_TOOLS}
    assert "diff_revision" in names


@pytest.mark.asyncio
async def test_pdf_read_tables_delegates_to_read_paper():
    from tools.pdfs import pdf_read_tables

    fake_slice = {"paper_id": "p1", "blocks": [{"kind": "table"}]}
    with patch("tools.pdfs.read_paper") as mock_rp:
        mock_rp.ainvoke = AsyncMock(return_value=fake_slice)
        out = await pdf_read_tables.ainvoke({"paper_id": "p1"}, config=CFG)

    assert out is fake_slice
    args = mock_rp.ainvoke.await_args
    # Tool-input dict goes first, RunnableConfig second.
    payload = args.args[0]
    assert payload["paper_id"] == "p1"
    assert payload["scope"] == {"kind": "blocks", "types": ["table"]}


@pytest.mark.asyncio
async def test_pdf_read_tables_passes_page_as_range_when_provided():
    from tools.pdfs import pdf_read_tables

    with patch("tools.pdfs.read_paper") as mock_rp:
        mock_rp.ainvoke = AsyncMock(return_value={"blocks": []})
        await pdf_read_tables.ainvoke({"paper_id": "p1", "page": 4}, config=CFG)

    payload = mock_rp.ainvoke.await_args.args[0]
    # When a specific page is asked for, we switch to a pages scope so the
    # caller's "tables on page N" intent matches what comes back.
    assert payload["scope"]["kind"] == "pages"
    assert payload["scope"]["range"] == [4, 4]


@pytest.mark.asyncio
async def test_diff_revision_fetches_both_revisions():
    from tools.revisions import diff_revision

    rev_a_payload = {"id": "rA", "contentMd": "old text"}
    rev_b_payload = {"id": "rB", "contentMd": "new text"}

    async def fake_get(path: str, *, user_id: str):
        assert user_id == USER
        if path.endswith("/rA"):
            return rev_a_payload
        if path.endswith("/rB"):
            return rev_b_payload
        raise AssertionError(f"unexpected path: {path}")

    with patch("tools.revisions.km_get", new=fake_get):
        out = await diff_revision.ainvoke(
            {"note_id": "n1", "rev_a": "rA", "rev_b": "rB"}, config=CFG
        )

    assert out == {
        "note_id": "n1",
        "rev_a": rev_a_payload,
        "rev_b": rev_b_payload,
    }
