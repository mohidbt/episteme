from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx

from .base import PaperResult, PaperSearchService

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.semanticscholar.org/graph/v1"
_FIELDS = "title,authors,year,venue,externalIds,openAccessPdf,citationCount,abstract"

_api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
_semaphore = asyncio.Semaphore(10 if _api_key else 1)
_client = httpx.AsyncClient(timeout=30.0)
_last_request_time: float = 0.0
_lock = asyncio.Lock()


def _snippet(abstract: str | None) -> str | None:
    if not abstract:
        return None
    return abstract[:200]


def _resolve_pdf_url(oa_pdf: dict | None, ext_ids: dict) -> str | None:
    """Return best available open-access PDF URL.

    S2's openAccessPdf is often null even for open-access papers.
    Fall back to constructing a PDF URL from externalIds when available.
    """
    if oa_pdf and oa_pdf.get("url"):
        return oa_pdf["url"]
    arxiv_id = ext_ids.get("ArXiv") or ext_ids.get("ARXIV")
    if arxiv_id:
        return f"https://arxiv.org/pdf/{arxiv_id}"
    pmcid = ext_ids.get("PubMedCentral") or ext_ids.get("PMCID")
    if pmcid:
        return f"https://www.ncbi.nlm.nih.gov/pmc/articles/{pmcid}/pdf"
    acl_id = ext_ids.get("ACL") or ext_ids.get("AclId")
    if acl_id:
        return f"https://aclanthology.org/{acl_id}.pdf"
    return None


def _parse_paper(data: dict) -> PaperResult:
    authors = [a["name"] for a in data.get("authors", []) if a.get("name")]
    ext_ids = {k: v for k, v in data.get("externalIds", {}).items() if v}
    oa_pdf = data.get("openAccessPdf")
    return PaperResult(
        paper_id=data.get("paperId", ""),
        title=data.get("title", ""),
        authors=authors,
        year=str(data["year"]) if data.get("year") is not None else None,
        venue=data.get("venue"),
        doi=ext_ids.get("DOI"),
        open_access_pdf_url=_resolve_pdf_url(oa_pdf, ext_ids),
        citation_count=data.get("citationCount"),
        abstract_snippet=_snippet(data.get("abstract")),
        match_confidence="medium",
        external_ids=ext_ids,
    )


class S2Error(Exception):
    """Semantic Scholar API returned a non-200 status."""

    def __init__(self, status: int, body: str):
        self.status = status
        self.body = body[:500]
        super().__init__(f"S2 API {status}: {self.body}")


async def _throttled_get(url: str, params: dict | None = None) -> httpx.Response:
    global _last_request_time
    async with _semaphore:
        if not _api_key:
            async with _lock:
                now = time.monotonic()
                wait = 1.0 - (now - _last_request_time)
                if wait > 0:
                    await asyncio.sleep(wait)
                _last_request_time = time.monotonic()
        headers = {"x-api-key": _api_key} if _api_key else {}
        return await _client.get(url, params=params, headers=headers)


async def _search_request(url: str, params: dict) -> httpx.Response:
    """Make an S2 API request with exponential backoff on 429."""
    response = await _throttled_get(url, params=params)
    for attempt in range(3):
        if response.status_code != 429:
            break
        wait = 3 * (2 ** attempt)  # 3s, 6s, 12s
        logger.warning("S2 rate-limited, retrying in %ds (attempt %d)", wait, attempt + 1)
        await asyncio.sleep(wait)
        response = await _throttled_get(url, params=params)
    return response


class SemanticScholarSearch(PaperSearchService):
    async def search_by_doi(self, doi: str) -> PaperResult | None:
        url = f"{_BASE_URL}/paper/DOI:{doi}"
        response = await _search_request(url, {"fields": _FIELDS})
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            logger.error("S2 DOI lookup failed: %s %s", response.status_code, response.text[:200])
            raise S2Error(response.status_code, response.text)
        result = _parse_paper(response.json())
        result.match_confidence = "exact"
        return result

    async def search_by_query(
        self,
        query: str,
        year: str | None = None,
        limit: int = 5,
    ) -> list[PaperResult]:
        params: dict = {"query": query, "limit": limit, "fields": _FIELDS}
        if year:
            params["year"] = year
        response = await _search_request(f"{_BASE_URL}/paper/search", params)
        if response.status_code != 200:
            logger.error("S2 query search failed: %s %s", response.status_code, response.text[:200])
            raise S2Error(response.status_code, response.text)
        data = response.json().get("data", [])
        results = []
        for i, entry in enumerate(data):
            paper = _parse_paper(entry)
            if i == 0:
                paper.match_confidence = "high"
            results.append(paper)
        return results