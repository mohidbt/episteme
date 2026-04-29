from __future__ import annotations

import asyncio
import os
import time

import httpx

from .base import PaperResult, PaperSearchService

_BASE_URL = "https://api.semanticscholar.org/graph/v1"
_FIELDS = "title,authors,year,venue,externalIds,openAccessPdf,citationCount,abstract"

_api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
_semaphore = asyncio.Semaphore(10 if _api_key else 1)
_client = httpx.AsyncClient()
_last_request_time: float = 0.0
_lock = asyncio.Lock()


def _snippet(abstract: str | None) -> str | None:
    if not abstract:
        return None
    return abstract[:200]


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
        open_access_pdf_url=oa_pdf.get("url") if oa_pdf else None,
        citation_count=data.get("citationCount"),
        abstract_snippet=_snippet(data.get("abstract")),
        match_confidence="medium",
        external_ids=ext_ids,
    )


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


class SemanticScholarSearch(PaperSearchService):
    async def search_by_doi(self, doi: str) -> PaperResult | None:
        url = f"{_BASE_URL}/paper/DOI:{doi}"
        response = await _throttled_get(url, params={"fields": _FIELDS})
        if response.status_code == 404:
            return None
        if response.status_code == 429:
            await asyncio.sleep(2)
            response = await _throttled_get(url, params={"fields": _FIELDS})
            if response.status_code != 200:
                return None
        if response.status_code != 200:
            return None
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
        response = await _throttled_get(f"{_BASE_URL}/paper/search", params=params)
        if response.status_code == 429:
            await asyncio.sleep(2)
            response = await _throttled_get(f"{_BASE_URL}/paper/search", params=params)
            if response.status_code != 200:
                return []
        if response.status_code != 200:
            return []
        data = response.json().get("data", [])
        results = []
        for i, entry in enumerate(data):
            paper = _parse_paper(entry)
            if i == 0:
                paper.match_confidence = "high"
            results.append(paper)
        return results