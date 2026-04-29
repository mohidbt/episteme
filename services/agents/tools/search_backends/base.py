"""Abstract base class for paper search backends.

Each backend implements search_by_doi (exact match) and search_by_query
(fuzzy match returning up to `limit` results). Backends are pluggable —
swap SemanticScholarSearch for a different backend without touching tools.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class PaperResult:
    """A single paper match from a search backend."""

    paper_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: str | None = None
    venue: str | None = None
    doi: str | None = None
    open_access_pdf_url: str | None = None
    citation_count: int | None = None
    abstract_snippet: str | None = None
    # "exact" = DOI match, "high" = title+author+year align,
    # "medium" = partial match
    match_confidence: str = "medium"
    # Raw external IDs from the source (e.g. ArXiv, PubMed)
    external_ids: dict[str, str] = field(default_factory=dict)


class PaperSearchService(ABC):
    """Pluggable paper search backend."""

    @abstractmethod
    async def search_by_doi(self, doi: str) -> PaperResult | None:
        """Look up a paper by its DOI. Returns None if not found."""

    @abstractmethod
    async def search_by_query(
        self,
        query: str,
        year: str | None = None,
        limit: int = 5,
    ) -> list[PaperResult]:
        """Search for papers by title/author/year.

        Returns up to `limit` results ranked by relevance.
        """