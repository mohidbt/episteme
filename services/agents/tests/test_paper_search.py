"""Tests for agentic_search_papers and agentic_fetch_papers tools."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.paper_search import agentic_fetch_papers, agentic_search_papers
from tools.paper_search import search_papers_online


# -- Fixtures ----------------------------------------------------------------

REFERENCE_WITH_DOI = {
    "id": "ref-1",
    "citationKey": "vaswani2017attention",
    "cslJson": {
        "type": "article",
        "title": "Attention Is All You Need",
        "author": [{"family": "Vaswani", "given": "Ashish"}, {"family": "Shazeer", "given": "Noam"}],
        "issued": {"date-parts": [[2017]]},
        "DOI": "10.5555/3295222.3295349",
    },
    "semanticScholarId": None,
    "libraryId": 42,
    "folderId": "folder-1",
    "paperId": None,
}

REFERENCE_NO_DOI = {
    "id": "ref-2",
    "citationKey": "devlin2019bert",
    "cslJson": {
        "type": "article",
        "title": "BERT: Pre-training of Deep Bidirectional Transformers",
        "author": [{"family": "Devlin", "given": "Jacob"}],
        "issued": {"date-parts": [[2019]]},
    },
    "semanticScholarId": None,
    "libraryId": 42,
    "folderId": "folder-1",
    "paperId": None,
}

REFERENCE_EMPTY = {
    "id": "ref-3",
    "citationKey": "empty-ref",
    "cslJson": {},
    "semanticScholarId": None,
    "libraryId": 42,
    "folderId": "folder-1",
    "paperId": None,
}

REFERENCE_ALREADY_LINKED = {
    **REFERENCE_WITH_DOI,
    "paperId": "paper-existing",
}

S2_PAPER_RESULT = {
    "paperId": "s2-abc123",
    "title": "Attention Is All You Need",
    "authors": [{"name": "Ashish Vaswani"}, {"name": "Noam Shazeer"}],
    "year": 2017,
    "venue": "NeurIPS",
    "externalIds": {"DOI": "10.5555/3295222.3295349"},
    "openAccessPdf": {"url": "https://pdfs.com/attention.pdf"},
    "citationCount": 50000,
    "abstract": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
}


def _make_config(user_id: str = "test-user") -> dict:
    return {"configurable": {"user_id": user_id}}


# -- agentic_search_papers tests ---------------------------------------------


@pytest.mark.asyncio
async def test_search_with_doi_exact_match():
    s2_result = S2_PAPER_RESULT.copy()
    with (
        patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get,
        patch("tools.paper_search.SemanticScholarSearch") as mock_backend_cls,
    ):
        mock_km_get.return_value = REFERENCE_WITH_DOI
        mock_backend = AsyncMock()
        mock_backend.search_by_doi.return_value = _s2_to_paper_result(s2_result, confidence="exact")
        mock_backend_cls.return_value = mock_backend

        result = await agentic_search_papers.ainvoke(
            {"reference_id": "ref-1"}, config=_make_config()
        )

    assert result["found"] is True
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["match_confidence"] == "exact"
    assert result["candidates"][0]["doi"] == "10.5555/3295222.3295349"


@pytest.mark.asyncio
async def test_search_doi_not_found_falls_back_to_query():
    s2_results = [
        {**S2_PAPER_RESULT, "paperId": "s2-def456", "title": "Similar Paper"},
    ]
    with (
        patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get,
        patch("tools.paper_search.SemanticScholarSearch") as mock_backend_cls,
    ):
        mock_km_get.return_value = REFERENCE_WITH_DOI
        mock_backend = AsyncMock()
        mock_backend.search_by_doi.return_value = None
        mock_backend.search_by_query.return_value = [
            _s2_to_paper_result(r, confidence="high") for r in s2_results
        ]
        mock_backend_cls.return_value = mock_backend

        result = await agentic_search_papers.ainvoke(
            {"reference_id": "ref-1"}, config=_make_config()
        )

    assert result["found"] is True
    assert len(result["candidates"]) == 1
    mock_backend.search_by_query.assert_called_once()


@pytest.mark.asyncio
async def test_search_no_doi_uses_query():
    with (
        patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get,
        patch("tools.paper_search.SemanticScholarSearch") as mock_backend_cls,
    ):
        mock_km_get.return_value = REFERENCE_NO_DOI
        mock_backend = AsyncMock()
        mock_backend.search_by_query.return_value = []
        mock_backend_cls.return_value = mock_backend

        result = await agentic_search_papers.ainvoke(
            {"reference_id": "ref-2"}, config=_make_config()
        )

    assert result["found"] is False
    mock_backend.search_by_query.assert_called_once()


@pytest.mark.asyncio
async def test_search_empty_reference_returns_no_match():
    with patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get:
        mock_km_get.return_value = REFERENCE_EMPTY

        result = await agentic_search_papers.ainvoke(
            {"reference_id": "ref-3"}, config=_make_config()
        )

    assert result["found"] is False
    assert "Add a title or DOI" in result["suggestion"]


@pytest.mark.asyncio
async def test_search_semantic_scholar_id_boost():
    s2_results = [
        _s2_to_paper_result({**S2_PAPER_RESULT, "paperId": "s2-other"}, confidence="high"),
        _s2_to_paper_result({**S2_PAPER_RESULT, "paperId": "s2-match"}, confidence="medium"),
    ]
    ref_with_s2 = {**REFERENCE_NO_DOI, "semanticScholarId": "s2-match"}

    with (
        patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get,
        patch("tools.paper_search.SemanticScholarSearch") as mock_backend_cls,
    ):
        mock_km_get.return_value = ref_with_s2
        mock_backend = AsyncMock()
        mock_backend.search_by_query.return_value = s2_results
        mock_backend_cls.return_value = mock_backend

        result = await agentic_search_papers.ainvoke(
            {"reference_id": "ref-2"}, config=_make_config()
        )

    # s2-match should be boosted to rank 1
    assert result["candidates"][0]["paper_id"] == "s2-match"


@pytest.mark.asyncio
async def test_search_reference_not_found():
    with patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get:
        mock_km_get.return_value = {"error": True, "status": 404}

        result = await agentic_search_papers.ainvoke(
            {"reference_id": "ref-999"}, config=_make_config()
        )

    assert result["found"] is False
    assert "not found" in result["suggestion"].lower()


# -- agentic_fetch_papers tests ----------------------------------------------


@pytest.mark.asyncio
async def test_fetch_reference_already_linked():
    with patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get:
        mock_km_get.return_value = REFERENCE_ALREADY_LINKED

        result = await agentic_fetch_papers.ainvoke(
            {
                "reference_id": "ref-1",
                "paper_url": "https://pdfs.com/paper.pdf",
                "paper_metadata": {"title": "Test Paper"},
            },
            config=_make_config(),
        )

    assert result["success"] is True
    assert result["already_linked"] is True
    assert result["existing_paper_id"] == "paper-existing"


@pytest.mark.asyncio
async def test_fetch_download_failure():
    with (
        patch("tools.paper_search.km_get", new_callable=AsyncMock) as mock_km_get,
        patch("tools.paper_search.httpx.AsyncClient") as mock_client_cls,
    ):
        mock_km_get.return_value = REFERENCE_NO_DOI
        mock_client = AsyncMock()
        mock_client.get.side_effect = Exception("network error")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await agentic_fetch_papers.ainvoke(
            {
                "reference_id": "ref-2",
                "paper_url": "https://pdfs.com/broken.pdf",
                "paper_metadata": {"title": "Broken Paper"},
            },
            config=_make_config(),
        )

    assert result["success"] is False
    assert "download failed" in result["error"].lower() or "PDF" in result["error"]


@pytest.mark.asyncio
async def test_fetch_finalize_error_payload_fails_and_does_not_patch_reference():
    pdf_resp = MagicMock()
    pdf_resp.content = b"%PDF-1.7"
    pdf_resp.raise_for_status = MagicMock()
    put_resp = MagicMock()
    put_resp.raise_for_status = MagicMock()

    clients = [AsyncMock(), AsyncMock()]
    clients[0].get.return_value = pdf_resp
    clients[1].put.return_value = put_resp
    for c in clients:
        c.__aenter__.return_value = c
        c.__aexit__.return_value = False

    with (
        patch("tools.paper_search.km_get", new_callable=AsyncMock, return_value=REFERENCE_NO_DOI),
        patch(
            "tools.paper_search.km_post",
            new_callable=AsyncMock,
            side_effect=[
                {"id": "paper-new", "presignedUrl": "https://upload"},
                {"error": True, "status": 500, "body": {"error": "finalize failed"}},
            ],
        ) as mock_km_post,
        patch("tools.paper_search.km_patch", new_callable=AsyncMock) as mock_km_patch,
        patch("tools.paper_search.httpx.AsyncClient", side_effect=clients),
    ):
        result = await agentic_fetch_papers.ainvoke(
            {"reference_id": "ref-2", "paper_url": "https://pdfs.com/paper.pdf"},
            config=_make_config(),
        )

    assert result["success"] is False
    assert "finalize" in result["error"].lower()
    mock_km_patch.assert_not_awaited()
    assert mock_km_post.await_count == 2


@pytest.mark.asyncio
async def test_fetch_finalize_exception_fails_and_does_not_patch_reference():
    pdf_resp = MagicMock()
    pdf_resp.content = b"%PDF-1.7"
    pdf_resp.raise_for_status = MagicMock()
    put_resp = MagicMock()
    put_resp.raise_for_status = MagicMock()

    clients = [AsyncMock(), AsyncMock()]
    clients[0].get.return_value = pdf_resp
    clients[1].put.return_value = put_resp
    for c in clients:
        c.__aenter__.return_value = c
        c.__aexit__.return_value = False

    with (
        patch("tools.paper_search.km_get", new_callable=AsyncMock, return_value=REFERENCE_NO_DOI),
        patch(
            "tools.paper_search.km_post",
            new_callable=AsyncMock,
            side_effect=[
                {"id": "paper-new", "presignedUrl": "https://upload"},
                RuntimeError("finalize crashed"),
            ],
        ),
        patch("tools.paper_search.km_patch", new_callable=AsyncMock) as mock_km_patch,
        patch("tools.paper_search.httpx.AsyncClient", side_effect=clients),
    ):
        result = await agentic_fetch_papers.ainvoke(
            {"reference_id": "ref-2", "paper_url": "https://pdfs.com/paper.pdf"},
            config=_make_config(),
        )

    assert result["success"] is False
    assert "finalize" in result["error"].lower()
    mock_km_patch.assert_not_awaited()


# -- Helper ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_papers_online_parses_semantic_scholar_response():
    from tools.search_backends.semantic_scholar import PaperResult

    fake_results = [
        PaperResult(
            paper_id="pid-a",
            title="Paper A",
            authors=["Alice", "Bob"],
            year=2023,
            venue=None,
            doi=None,
            open_access_pdf_url="https://www.semanticscholar.org/paper/pid-a",
            citation_count=None,
            abstract_snippet="x" * 500,
            match_confidence="medium",
        ),
        PaperResult(
            paper_id="pid-b",
            title="Paper B",
            authors=[],
            year=2021,
            venue=None,
            doi=None,
            open_access_pdf_url="https://www.semanticscholar.org/paper/pid-b",
            citation_count=None,
            abstract_snippet="",
            match_confidence="medium",
        ),
    ]

    with patch(
        "tools.paper_search.SemanticScholarSearch.search_by_query",
        new=AsyncMock(return_value=fake_results),
    ):
        result = await search_papers_online.ainvoke({"query": "transformers"})

    assert isinstance(result, list)
    assert len(result) == 2
    assert set(result[0].keys()) == {"title", "authors", "year", "abstract", "paperId", "doi", "url"}
    assert result[0]["authors"] == ["Alice", "Bob"]
    assert len(result[0]["abstract"]) == 300
    assert result[1]["authors"] == []
    assert result[1]["abstract"] == ""


def _s2_to_paper_result(s2_data: dict, confidence: str = "medium"):
    """Convert S2 API response dict to PaperResult-like object for mocking."""
    from tools.search_backends.base import PaperResult
    from tools.search_backends.semantic_scholar import _resolve_pdf_url

    ext_ids = s2_data.get("externalIds", {})
    oa_pdf = s2_data.get("openAccessPdf")
    abstract = s2_data.get("abstract", "")
    return PaperResult(
        paper_id=s2_data.get("paperId", ""),
        title=s2_data.get("title", ""),
        authors=[a["name"] for a in s2_data.get("authors", []) if a.get("name")],
        year=str(s2_data["year"]) if s2_data.get("year") is not None else None,
        venue=s2_data.get("venue"),
        doi=ext_ids.get("DOI"),
        open_access_pdf_url=_resolve_pdf_url(oa_pdf, ext_ids),
        citation_count=s2_data.get("citationCount"),
        abstract_snippet=abstract[:200] if abstract else None,
        match_confidence=confidence,
        external_ids=ext_ids,
    )
