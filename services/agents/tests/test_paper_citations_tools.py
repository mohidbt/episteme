"""GSD-55: paper_citations — citation pipeline tools.

Wraps post-1.6 KM citation routes that had zero agent coverage:

* GET   /api/papers/{id}/citations
* POST  /api/papers/{id}/citations/extract[?force=1]
* POST  /api/papers/{id}/citations/enrich
* POST  /api/papers/{id}/citations/rematch
* GET   /api/papers/{id}/citations/edges?direction=
* GET   /api/papers/{id}/citations/markers
* POST  /api/papers/{id}/citations/{refId}/keep
* POST  /api/papers/{id}/citations/{refId}/save

Destructive / cost-heavy ops carry require_approval.
"""
from __future__ import annotations

import os

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402

USER = "user_test_1"
CFG = {"configurable": {"user_id": USER}}


@pytest.mark.parametrize(
    "name",
    [
        "list_paper_citations",
        "extract_paper_citations",
        "enrich_paper_citations",
        "rematch_paper_citations",
        "list_paper_citation_edges",
        "list_paper_citation_markers",
        "keep_paper_citation",
        "save_paper_citation_to_library",
    ],
)
def test_paper_citations_tool_in_TOOLS(name):
    from tools import ALL_TOOLS

    assert name in {t.name for t in ALL_TOOLS}


@pytest.mark.parametrize(
    "name",
    [
        "extract_paper_citations",
        "enrich_paper_citations",
        "save_paper_citation_to_library",
    ],
)
def test_costly_or_destructive_ops_require_approval(name):
    from tools import paper_citations

    fn = getattr(paper_citations, name)
    md = getattr(fn, "metadata", None) or {}
    assert md.get("require_approval") is True, name


@pytest.mark.parametrize(
    "name",
    [
        "list_paper_citations",
        "list_paper_citation_edges",
        "list_paper_citation_markers",
        "rematch_paper_citations",
        "keep_paper_citation",
    ],
)
def test_safe_ops_no_approval(name):
    from tools import paper_citations

    fn = getattr(paper_citations, name)
    md = getattr(fn, "metadata", None) or {}
    assert md.get("require_approval") is not True, name


@pytest.mark.asyncio
async def test_list_paper_citations_calls_get():
    from tools.paper_citations import list_paper_citations

    with patch("tools.paper_citations.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"citations": []}
        out = await list_paper_citations.ainvoke({"paper_id": "p1"}, config=CFG)

    call = mock_get.await_args
    assert call.args[0] == "/api/papers/p1/citations"
    assert call.kwargs["user_id"] == USER
    assert out == {"citations": []}


@pytest.mark.asyncio
async def test_extract_paper_citations_posts_with_empty_body():
    from tools.paper_citations import extract_paper_citations

    with patch("tools.paper_citations.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"references": [], "stats": {}}
        await extract_paper_citations.ainvoke({"paper_id": "p1"}, config=CFG)

    call = mock_post.await_args
    assert call.args[0] == "/api/papers/p1/citations/extract"
    assert call.args[1] == {}
    assert call.kwargs["user_id"] == USER


@pytest.mark.asyncio
async def test_extract_paper_citations_force_appends_query():
    from tools.paper_citations import extract_paper_citations

    with patch("tools.paper_citations.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"references": []}
        await extract_paper_citations.ainvoke(
            {"paper_id": "p1", "force": True}, config=CFG
        )

    assert mock_post.await_args.args[0] == "/api/papers/p1/citations/extract?force=1"


@pytest.mark.asyncio
async def test_enrich_paper_citations_posts():
    from tools.paper_citations import enrich_paper_citations

    with patch("tools.paper_citations.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"enriched": 3, "total": 5}
        out = await enrich_paper_citations.ainvoke({"paper_id": "p1"}, config=CFG)

    call = mock_post.await_args
    assert call.args[0] == "/api/papers/p1/citations/enrich"
    assert call.args[1] == {}
    assert out["enriched"] == 3


@pytest.mark.asyncio
async def test_rematch_paper_citations_posts():
    from tools.paper_citations import rematch_paper_citations

    with patch("tools.paper_citations.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"linked": 2}
        out = await rematch_paper_citations.ainvoke({"paper_id": "p1"}, config=CFG)

    call = mock_post.await_args
    assert call.args[0] == "/api/papers/p1/citations/rematch"
    assert call.args[1] == {}
    assert out["linked"] == 2


@pytest.mark.asyncio
async def test_list_paper_citation_edges_default_direction():
    from tools.paper_citations import list_paper_citation_edges

    with patch("tools.paper_citations.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"edges": []}
        await list_paper_citation_edges.ainvoke({"paper_id": "p1"}, config=CFG)

    assert (
        mock_get.await_args.args[0]
        == "/api/papers/p1/citations/edges?direction=citing"
    )


@pytest.mark.asyncio
async def test_list_paper_citation_edges_cited_in_direction():
    from tools.paper_citations import list_paper_citation_edges

    with patch("tools.paper_citations.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"edges": []}
        await list_paper_citation_edges.ainvoke(
            {"paper_id": "p1", "direction": "cited-in"}, config=CFG
        )

    assert (
        mock_get.await_args.args[0]
        == "/api/papers/p1/citations/edges?direction=cited-in"
    )


@pytest.mark.asyncio
async def test_list_paper_citation_markers_calls_get():
    from tools.paper_citations import list_paper_citation_markers

    with patch("tools.paper_citations.km_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = {"markers": []}
        await list_paper_citation_markers.ainvoke({"paper_id": "p1"}, config=CFG)

    assert mock_get.await_args.args[0] == "/api/papers/p1/citations/markers"


@pytest.mark.asyncio
async def test_keep_paper_citation_posts():
    from tools.paper_citations import keep_paper_citation

    with patch("tools.paper_citations.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"keptId": 42, "alreadyKept": False}
        out = await keep_paper_citation.ainvoke(
            {"paper_id": "p1", "ref_id": 7}, config=CFG
        )

    call = mock_post.await_args
    assert call.args[0] == "/api/papers/p1/citations/7/keep"
    assert call.args[1] == {}
    assert out["keptId"] == 42


@pytest.mark.asyncio
async def test_save_paper_citation_to_library_posts():
    from tools.paper_citations import save_paper_citation_to_library

    with patch("tools.paper_citations.km_post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = {"libraryReferenceId": 9, "keptId": 11}
        out = await save_paper_citation_to_library.ainvoke(
            {"paper_id": "p1", "ref_id": 7}, config=CFG
        )

    call = mock_post.await_args
    assert call.args[0] == "/api/papers/p1/citations/7/save"
    assert call.args[1] == {}
    assert out["libraryReferenceId"] == 9
