"""Tests for PaperSearchService and SemanticScholarSearch backend."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.search_backends.semantic_scholar import SemanticScholarSearch


S2_DOI_RESPONSE = {
    "paperId": "abc123",
    "title": "Attention Is All You Need",
    "authors": [{"name": "Ashish Vaswani"}, {"name": "Noam Shazeer"}],
    "year": 2017,
    "venue": "NeurIPS",
    "externalIds": {"DOI": "10.5555/3295222.3295349", "ArXiv": "1706.03762"},
    "openAccessPdf": {"url": "https://pdfs.com/attention.pdf"},
    "citationCount": 50000,
    "abstract": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
}

S2_QUERY_RESPONSE = {
    "total": 2,
    "offset": 0,
    "data": [
        {
            "paperId": "def456",
            "title": "BERT: Pre-training of Deep Bidirectional Transformers",
            "authors": [{"name": "Jacob Devlin"}],
            "year": 2019,
            "venue": "NAACL",
            "externalIds": {"DOI": "10.18653/v1/N19-1423"},
            "openAccessPdf": {"url": "https://pdfs.com/bert.pdf"},
            "citationCount": 30000,
            "abstract": "We introduce a new language representation model called BERT.",
        },
        {
            "paperId": "ghi789",
            "title": "GPT-3: Language Models are Few-Shot Learners",
            "authors": [{"name": "Tom Brown"}],
            "year": 2020,
            "venue": "NeurIPS",
            "externalIds": {},
            "openAccessPdf": None,
            "citationCount": 20000,
            "abstract": None,
        },
    ],
}


@pytest.mark.asyncio
async def test_search_by_doi_found():
    backend = SemanticScholarSearch()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = S2_DOI_RESPONSE

    with patch("tools.search_backends.semantic_scholar._throttled_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response
        result = await backend.search_by_doi("10.5555/3295222.3295349")

    assert result is not None
    assert result.title == "Attention Is All You Need"
    assert result.match_confidence == "exact"
    assert result.doi == "10.5555/3295222.3295349"
    assert result.open_access_pdf_url == "https://pdfs.com/attention.pdf"


@pytest.mark.asyncio
async def test_search_by_doi_not_found():
    backend = SemanticScholarSearch()
    mock_response = MagicMock()
    mock_response.status_code = 404

    with patch("tools.search_backends.semantic_scholar._throttled_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response
        result = await backend.search_by_doi("10.9999/nonexistent")

    assert result is None


@pytest.mark.asyncio
async def test_search_by_query_returns_results():
    backend = SemanticScholarSearch()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = S2_QUERY_RESPONSE

    with patch("tools.search_backends.semantic_scholar._throttled_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response
        results = await backend.search_by_query("BERT", year="2019", limit=5)

    assert len(results) == 2
    assert results[0].match_confidence == "high"  # first result gets "high"
    assert results[1].match_confidence == "medium"
    assert results[0].title == "BERT: Pre-training of Deep Bidirectional Transformers"


@pytest.mark.asyncio
async def test_search_by_query_empty():
    backend = SemanticScholarSearch()
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"total": 0, "offset": 0, "data": []}

    with patch("tools.search_backends.semantic_scholar._throttled_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response
        results = await backend.search_by_query("nonexistent paper xyz")

    assert results == []


@pytest.mark.asyncio
async def test_search_by_doi_rate_limit_retry():
    backend = SemanticScholarSearch()
    mock_429 = MagicMock()
    mock_429.status_code = 429
    mock_200 = MagicMock()
    mock_200.status_code = 200
    mock_200.json.return_value = S2_DOI_RESPONSE

    with patch("tools.search_backends.semantic_scholar._throttled_get", new_callable=AsyncMock) as mock_get:
        mock_get.side_effect = [mock_429, mock_200]
        with patch("tools.search_backends.semantic_scholar.asyncio.sleep", new_callable=AsyncMock):
            result = await backend.search_by_doi("10.5555/3295222.3295349")

    assert result is not None
    assert result.match_confidence == "exact"


@pytest.mark.asyncio
async def test_search_by_doi_server_error():
    backend = SemanticScholarSearch()
    mock_response = MagicMock()
    mock_response.status_code = 500

    with patch("tools.search_backends.semantic_scholar._cache_get", return_value=None), \
         patch("tools.search_backends.semantic_scholar._throttled_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response
        result = await backend.search_by_doi("10.5555/3295222.3295349")

    assert result is None


@pytest.mark.asyncio
async def test_abstract_snippet_truncation():
    long_abstract = "x" * 500
    data = {**S2_DOI_RESPONSE, "abstract": long_abstract}
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = data

    with patch("tools.search_backends.semantic_scholar._throttled_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response
        from tools.search_backends.semantic_scholar import _parse_paper
        result = _parse_paper(data)

    assert result.abstract_snippet is not None
    assert len(result.abstract_snippet) == 200


@pytest.mark.asyncio
async def test_null_abstract():
    data = {**S2_DOI_RESPONSE, "abstract": None}
    from tools.search_backends.semantic_scholar import _parse_paper
    result = _parse_paper(data)

    assert result.abstract_snippet is None