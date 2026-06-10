"""LangChain tools: citation pipeline over a paper's references.

Closes the post-1.6 agent-coverage gap on KM citation routes.

KM routes wrapped:
* GET   /api/papers/{id}/citations              — list extracted references
* POST  /api/papers/{id}/citations/extract      — run extract (LLM + S2)
* POST  /api/papers/{id}/citations/enrich       — S2 metadata fanout
* POST  /api/papers/{id}/citations/rematch      — re-run auto-link
* GET   /api/papers/{id}/citations/edges        — paper-citations graph edges
* GET   /api/papers/{id}/citations/markers      — inline citation marker rects
* POST  /api/papers/{id}/citations/{refId}/keep — mark a reference as kept
* POST  /api/papers/{id}/citations/{refId}/save — promote to library + references

Cost-heavy / library-mutating ops (extract, enrich, save) carry
``require_approval`` metadata so HumanInTheLoopMiddleware gates them.
The authenticated user_id is injected at runtime via ``RunnableConfig``.

NOTE — auth gap: every wrapped KM route currently uses ``getUserIdFromRequest``
(cookie-only), not ``getAuthedUserId`` (HMAC dual-auth). Until the routes are
migrated, these tools will 401 against live KM. Filed as follow-up; tool wiring
ships now per the GSD-55 brief.
"""
from __future__ import annotations

from typing import Literal
from urllib.parse import quote

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get, km_post
from tools._auth import user_id_from_config


def _p(paper_id: str) -> str:
    return quote(paper_id, safe="")


# ---------------------------------------------------------------------------
# Read-only
# ---------------------------------------------------------------------------


@tool
async def list_paper_citations(paper_id: str, *, config: RunnableConfig) -> object:
    """List extracted references for a paper.

    Returns the citations array (raw text, parsed title/authors/year, DOI,
    S2 metadata when enriched, and the matched paper id if auto-linked).

    Args:
        paper_id: Paper UUID.
    """
    user_id = user_id_from_config(config)
    return await km_get(f"/api/papers/{_p(paper_id)}/citations", user_id=user_id)


@tool
async def list_paper_citation_edges(
    paper_id: str,
    direction: Literal["citing", "cited-in"] = "citing",
    *,
    config: RunnableConfig,
) -> object:
    """List paper-citation graph edges for a paper.

    Args:
        paper_id: Paper UUID.
        direction: ``"citing"`` (default) — papers/references this paper cites.
            ``"cited-in"`` — papers in the user's library that cite this one.
    """
    user_id = user_id_from_config(config)
    return await km_get(
        f"/api/papers/{_p(paper_id)}/citations/edges?direction={direction}",
        user_id=user_id,
    )


@tool
async def list_paper_citation_markers(
    paper_id: str, *, config: RunnableConfig
) -> object:
    """List inline citation marker rectangles (per-page bounding boxes) for a paper.

    Used to overlay citation markers on the PDF reader.

    Args:
        paper_id: Paper UUID.
    """
    user_id = user_id_from_config(config)
    return await km_get(
        f"/api/papers/{_p(paper_id)}/citations/markers", user_id=user_id
    )


# ---------------------------------------------------------------------------
# Pipeline ops
# ---------------------------------------------------------------------------


@tool
async def extract_paper_citations(
    paper_id: str, force: bool = False, *, config: RunnableConfig
) -> object:
    """Extract citations from a paper's PDF (LLM + Semantic Scholar lookup).

    REQUIRES HUMAN APPROVAL — cost-heavy: runs an LLM pass over the PDF text
    plus per-reference Semantic Scholar enrichment. Idempotent by default —
    returns cached references if extraction already ran.

    Args:
        paper_id: Paper UUID.
        force: If True, re-runs extraction even when cached references exist.
            Use sparingly; doubles the LLM/S2 cost.
    """
    user_id = user_id_from_config(config)
    path = f"/api/papers/{_p(paper_id)}/citations/extract"
    if force:
        path += "?force=1"
    return await km_post(path, {}, user_id=user_id)


extract_paper_citations.metadata = {"require_approval": True}  # type: ignore[attr-defined]


@tool
async def enrich_paper_citations(paper_id: str, *, config: RunnableConfig) -> object:
    """Re-enrich a paper's extracted references via Semantic Scholar.

    REQUIRES HUMAN APPROVAL — fans out one S2 call per reference missing
    metadata. Safe to run repeatedly: only enriches rows without a
    semanticScholarId.

    Returns ``{enriched, total}``.

    Args:
        paper_id: Paper UUID.
    """
    user_id = user_id_from_config(config)
    return await km_post(
        f"/api/papers/{_p(paper_id)}/citations/enrich", {}, user_id=user_id
    )


enrich_paper_citations.metadata = {"require_approval": True}  # type: ignore[attr-defined]


@tool
async def rematch_paper_citations(paper_id: str, *, config: RunnableConfig) -> object:
    """Re-run paper_citations auto-link for a paper.

    Idempotent — existing edges are skipped (ON CONFLICT DO NOTHING).
    Returns ``{linked}`` with the count of new edges inserted.

    Args:
        paper_id: Paper UUID.
    """
    user_id = user_id_from_config(config)
    return await km_post(
        f"/api/papers/{_p(paper_id)}/citations/rematch", {}, user_id=user_id
    )


# ---------------------------------------------------------------------------
# Per-reference actions
# ---------------------------------------------------------------------------


@tool
async def keep_paper_citation(
    paper_id: str, ref_id: int, *, config: RunnableConfig
) -> object:
    """Mark an extracted reference as "kept" by the user.

    Idempotent toggle — returns ``{keptId, alreadyKept}``. Does not write to
    the user's references library; use ``save_paper_citation_to_library``
    for that.

    Args:
        paper_id: Paper UUID.
        ref_id: documentReferences row id (integer).
    """
    user_id = user_id_from_config(config)
    return await km_post(
        f"/api/papers/{_p(paper_id)}/citations/{ref_id}/keep", {}, user_id=user_id
    )


@tool
async def save_paper_citation_to_library(
    paper_id: str, ref_id: int, *, config: RunnableConfig
) -> object:
    """Promote an extracted reference into the user's library + references.

    REQUIRES HUMAN APPROVAL — writes a new libraryReferences row and a
    canonical references row, then marks the citation as kept.

    Returns ``{libraryReferenceId, keptId}``.

    Args:
        paper_id: Paper UUID.
        ref_id: documentReferences row id (integer).
    """
    user_id = user_id_from_config(config)
    return await km_post(
        f"/api/papers/{_p(paper_id)}/citations/{ref_id}/save", {}, user_id=user_id
    )


save_paper_citation_to_library.metadata = {"require_approval": True}  # type: ignore[attr-defined]


TOOLS = [
    list_paper_citations,
    list_paper_citation_edges,
    list_paper_citation_markers,
    extract_paper_citations,
    enrich_paper_citations,
    rematch_paper_citations,
    keep_paper_citation,
    save_paper_citation_to_library,
]
