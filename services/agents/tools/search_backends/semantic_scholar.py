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

# --- Bug #22 mitigations -----------------------------------------------------
# Process-wide query cache. Keyed by (query, year, limit, kind).
# Holds list[PaperResult] (or single PaperResult for DOI lookups). TTL gated
# in get/set helpers below.
_CACHE_TTL_SECONDS = 3600  # 1 hour
_query_cache: dict[tuple, tuple[float, object]] = {}

# Process-wide circuit breaker. When S2 returns 429 we set this to a wall-clock
# timestamp; any S2 call before that time short-circuits to the cache (or
# returns empty) instead of hammering the API.
_s2_cooldown_until: float = 0.0
_DEFAULT_COOLDOWN_SECONDS = 60.0


def _cache_get(key: tuple) -> object | None:
    entry = _query_cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.time() >= expires_at:
        _query_cache.pop(key, None)
        return None
    return value


def _cache_set(key: tuple, value: object) -> None:
    _query_cache[key] = (time.time() + _CACHE_TTL_SECONDS, value)


def _in_cooldown() -> bool:
    return time.time() < _s2_cooldown_until


def _trip_cooldown(retry_after: float | None) -> None:
    global _s2_cooldown_until
    wait = retry_after if (retry_after and retry_after > 0) else _DEFAULT_COOLDOWN_SECONDS
    _s2_cooldown_until = max(_s2_cooldown_until, time.time() + wait)
    logger.warning("S2 circuit breaker tripped for %.0fs", wait)


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After") if hasattr(response, "headers") else None
    if not raw:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


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
    """GET with backoff on 429. Honours Retry-After when present.

    On terminal 429, trips the global cooldown so subsequent callers
    short-circuit instead of hammering S2.
    """
    response = await _throttled_get(url, params=params)
    for attempt in range(3):
        if response.status_code != 429:
            break
        retry_after = _retry_after_seconds(response)
        wait = retry_after if retry_after is not None else 3 * (2 ** attempt)
        logger.warning("S2 rate-limited, retrying in %.1fs (attempt %d)", wait, attempt + 1)
        await asyncio.sleep(wait)
        response = await _throttled_get(url, params=params)
    if response.status_code == 429:
        _trip_cooldown(_retry_after_seconds(response))
    return response


class SemanticScholarSearch(PaperSearchService):
    async def search_by_doi(self, doi: str) -> PaperResult | None:
        cache_key = ("doi", doi)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached if isinstance(cached, PaperResult) else None
        if _in_cooldown():
            # Avoid hammering S2 during a known rate-limit window.
            return None
        url = f"{_BASE_URL}/paper/DOI:{doi}"
        response = await _search_request(url, {"fields": _FIELDS})
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            logger.error("S2 DOI lookup failed: %s %s", response.status_code, response.text[:200])
            raise S2Error(response.status_code, response.text)
        result = _parse_paper(response.json())
        result.match_confidence = "exact"
        _cache_set(cache_key, result)
        return result

    async def search_by_query(
        self,
        query: str,
        year: str | None = None,
        limit: int = 5,
    ) -> list[PaperResult]:
        cache_key = ("query", query, year, limit)
        cached = _cache_get(cache_key)
        if cached is not None:
            return list(cached)  # type: ignore[arg-type]
        if _in_cooldown():
            # Cooldown active — return empty rather than 429 the world.
            return []
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
        _cache_set(cache_key, list(results))
        return results

