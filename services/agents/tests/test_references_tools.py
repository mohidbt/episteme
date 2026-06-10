"""GSD-56: fill_reference + resolve_doi tools.

fill_reference: GET /api/references/{id} → POST /api/ai-fill (known+missing)
  → PATCH /api/references/{id} with cslJson merged from suggestion.

resolve_doi: GET /api/doi/{doi} (CrossRef CSL). Strips https://doi.org/
  prefix and lowercases for cache hits.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


def test_fill_reference_in_TOOLS():
    from tools import ALL_TOOLS

    assert "fill_reference" in {t.name for t in ALL_TOOLS}


def test_resolve_doi_in_TOOLS():
    from tools import ALL_TOOLS

    assert "resolve_doi" in {t.name for t in ALL_TOOLS}


@pytest.mark.asyncio
async def test_resolve_doi_strips_url_prefix_and_lowercases():
    from tools.references_ai import resolve_doi

    expected = {"title": "Some paper", "DOI": "10.1234/abc"}
    with patch("tools.references_ai.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = expected
        out = await resolve_doi.ainvoke(
            {"doi": "https://doi.org/10.1234/ABC"}, config=CFG
        )

    assert out == expected
    call = mock_get.await_args
    # URL prefix stripped + lowercased.
    assert call.args[0] == "/api/doi/10.1234%2Fabc"


@pytest.mark.asyncio
async def test_resolve_doi_propagates_404():
    from tools.references_ai import resolve_doi

    error_resp = {
        "error": True,
        "status": 404,
        "path": "/api/doi/bogus",
        "body": {"error": "not_found"},
    }
    with patch("tools.references_ai.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = error_resp
        out = await resolve_doi.ainvoke({"doi": "bogus"}, config=CFG)

    assert out == error_resp


@pytest.mark.asyncio
async def test_fill_reference_get_then_ai_fill_then_patch():
    from tools.references_ai import fill_reference

    ref_row = {
        "id": "r1",
        "cslJson": {"title": "Foo", "author": [{"family": "Bar"}]},
    }
    ai_suggestion = {"year": 2024, "abstract": "An abstract."}

    fake_get = AsyncMock(return_value=ref_row)
    fake_post = AsyncMock(return_value=ai_suggestion)
    fake_patch = AsyncMock(return_value={"ok": True})

    with (
        patch("tools.references_ai.km_get", new=fake_get),
        patch("tools.references_ai.km_post", new=fake_post),
        patch("tools.references_ai.km_patch", new=fake_patch),
    ):
        out = await fill_reference.ainvoke(
            {"ref_id": "r1", "fields": ["year", "abstract"]}, config=CFG
        )

    # GET fetches the existing reference row.
    assert fake_get.await_args.args[0] == "/api/references/r1"

    # POST /api/ai-fill carries kind+known+missing.
    post_call = fake_post.await_args
    assert post_call.args[0] == "/api/ai-fill"
    body = post_call.args[1]
    assert body["kind"] == "reference"
    assert body["missing"] == ["year", "abstract"]
    assert body["known"] == ref_row["cslJson"]

    # PATCH merges suggestion into cslJson.
    patch_call = fake_patch.await_args
    assert patch_call.args[0] == "/api/references/r1"
    patched_csl = patch_call.args[1]["cslJson"]
    assert patched_csl["year"] == 2024
    assert patched_csl["abstract"] == "An abstract."
    # Existing fields preserved.
    assert patched_csl["title"] == "Foo"

    assert out["suggestion"] == ai_suggestion
    assert out["ok"] is True


@pytest.mark.asyncio
async def test_fill_reference_handles_get_error():
    from tools.references_ai import fill_reference

    err = {"error": True, "status": 404, "body": "not_found"}
    with patch("tools.references_ai.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = err
        out = await fill_reference.ainvoke(
            {"ref_id": "nope", "fields": ["year"]}, config=CFG
        )
    assert out == err
