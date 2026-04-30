"""LangChain tools for agentic paper search and fetch.

Search uses Semantic Scholar to find candidate papers for a reference.
Fetch downloads the PDF, stores it via KM, and links it to the reference.
"""
from __future__ import annotations

import logging

import httpx
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get, km_patch, km_post
from tools._auth import user_id_from_config
from tools.search_backends import PaperResult, SemanticScholarSearch
from tools.search_backends.semantic_scholar import S2Error

logger = logging.getLogger(__name__)


def _candidate_dict(result: PaperResult, rank: int) -> dict:
    return {
        "rank": rank,
        "paper_id": result.paper_id,
        "title": result.title,
        "authors": result.authors,
        "year": result.year,
        "venue": result.venue,
        "doi": result.doi,
        "open_access_pdf_url": result.open_access_pdf_url,
        "citation_count": result.citation_count,
        "abstract_snippet": result.abstract_snippet,
        "match_confidence": result.match_confidence,
    }


@tool
async def agentic_search_papers(
    reference_id: str,
    *,
    config: RunnableConfig,
) -> object:
    """Find paper PDF candidates for a reference. Use this whenever the user
    asks to find, search, locate, or download a paper for a reference.

    Searches Semantic Scholar: exact DOI lookup first (confidence "exact"),
    then fuzzy search by title + first author + year (up to 5 candidates,
    confidence "high" or "medium"). Returns ranked candidates with
    match_confidence, title, authors, year, doi, citation_count,
    abstract_snippet, and open_access_pdf_url.

    After presenting a candidate to the user and getting approval, call
    agentic_fetch_papers to download the PDF and link it. Do NOT just tell
    the user the PDF URL — you must call agentic_fetch_papers to actually
    download and link it. If open_access_pdf_url is null, tell the user no
    free PDF is available. If the tool returns an error field, the search
    service is unavailable — tell the user, don't say "no paper found".
    """
    user_id = user_id_from_config(config)
    ref = await km_get(f"/api/references/{reference_id}", user_id=user_id)

    if isinstance(ref, dict) and ref.get("error"):
        return {"found": False, "suggestion": "Reference not found"}

    csl = ref.get("cslJson") or {}
    logger.debug("ref keys=%s csl keys=%s", list(ref.keys()), list(csl.keys()) if csl else [])

    title = csl.get("title") or ""
    authors = csl.get("author") or []
    year = None
    try:
        year = csl["issued"]["date-parts"][0][0]
    except (KeyError, IndexError, TypeError):
        pass
    doi = csl.get("DOI")
    existing_s2_id = ref.get("semanticScholarId")

    if not title and not authors and not doi:
        return {"found": False, "suggestion": "Add a title or DOI to this reference"}

    backend = SemanticScholarSearch()

    # DOI path: exact lookup
    if doi:
        try:
            result = await backend.search_by_doi(doi)
        except S2Error as exc:
            return {"found": False, "error": f"Semantic Scholar API error (DOI lookup): {exc}"}
        if result:
            return {
                "found": True,
                "candidates": [_candidate_dict(result, rank=1)],
                "reference_context": {
                    "id": reference_id,
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "doi": doi,
                },
            }
        # DOI not found — fall through to query path

    # Query path: fuzzy search
    first_author = ""
    if isinstance(authors, list) and authors:
        first = authors[0]
        if isinstance(first, dict):
            first_author = first.get("family") or first.get("name", "")
        else:
            first_author = str(first)

    query = f"{title} {first_author}".strip()
    year_str = str(year) if year else None
    try:
        results = await backend.search_by_query(query, year=year_str, limit=5)
    except S2Error as exc:
        return {"found": False, "error": f"Semantic Scholar API error (search): {exc}"}

    # Boost existing s2 match to rank 1
    if existing_s2_id and results:
        for i, r in enumerate(results):
            if r.paper_id == existing_s2_id:
                results.insert(0, results.pop(i))
                break

    candidates = [_candidate_dict(r, rank=i + 1) for i, r in enumerate(results)]

    return {
        "found": bool(candidates),
        "candidates": candidates,
        "reference_context": {
            "id": reference_id,
            "title": title,
            "authors": authors,
            "year": year,
            "doi": doi,
        },
    }


@tool
async def agentic_fetch_papers(
    reference_id: str,
    paper_url: str,
    paper_metadata: dict,
    *,
    config: RunnableConfig,
) -> object:
    """Download a paper PDF and link it to the reference. You MUST call this
    after the user approves a candidate from agentic_search_papers — do NOT
    just tell the user the URL, actually call this tool to download and link.

    Downloads PDF from paper_url (the open_access_pdf_url field), stores in S3,
    creates a papers row, and links the reference to the paper.
    Requires user approval (HITL interrupt) before executing.
    """
    user_id = user_id_from_config(config)
    ref = await km_get(f"/api/references/{reference_id}", user_id=user_id)

    if isinstance(ref, dict) and ref.get("error"):
        return {"success": False, "error": "Reference not found"}

    library_id = ref.get("libraryId")
    folder_id = ref.get("folderId")

    # Check if reference already has a paper linked
    existing_paper_id = ref.get("paperId")
    if existing_paper_id:
        return {
            "success": True,
            "already_linked": True,
            "existing_paper_id": existing_paper_id,
        }

    doi = paper_metadata.get("doi")

    # Download PDF
    pdf_bytes: bytes | None = None
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for attempt in range(2):
            try:
                resp = await client.get(paper_url)
                resp.raise_for_status()
                pdf_bytes = resp.content
                break
            except Exception as exc:
                logger.warning("PDF download attempt %d failed: %s", attempt + 1, exc)
                if attempt == 1:
                    return {"success": False, "error": f"PDF download failed: {exc}"}

    title = paper_metadata.get("title", "Untitled")
    slug = "".join(c if c.isalnum() or c in " -" else "" for c in title).strip()
    slug = slug.replace(" ", "-")[:80]

    # Create paper row — get presigned PUT URL + paper ID.
    # POST /api/papers only accepts: libraryId, folderId, filename, contentType, sizeBytes.
    # Metadata (title, authors, year, doi) is extracted from the PDF during finalize.
    pdf_size = len(pdf_bytes) if pdf_bytes else 0
    create_body = {
        "libraryId": library_id,
        "folderId": folder_id,
        "filename": f"{slug}.pdf",
        "contentType": "application/pdf",
        "sizeBytes": pdf_size,
    }
    create_resp = await km_post("/api/papers", create_body, user_id=user_id)
    if isinstance(create_resp, dict) and create_resp.get("error"):
        return {"success": False, "error": "Failed to create paper", "detail": create_resp}

    paper_id = create_resp.get("id") or create_resp.get("paperId")
    presigned_url = create_resp.get("presignedUrl") or create_resp.get("uploadUrl")

    # Upload PDF to S3
    if presigned_url and pdf_bytes:
        async with httpx.AsyncClient() as client:
            for attempt in range(2):
                try:
                    put_resp = await client.put(presigned_url, content=pdf_bytes)
                    put_resp.raise_for_status()
                    break
                except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                    logger.warning("S3 upload attempt %d failed: %s", attempt + 1, exc)
                    if attempt == 1:
                        return {"success": False, "error": f"S3 upload failed: {exc}"}

    # Finalize paper — triggers PDF processing
    await km_post(f"/api/papers/{paper_id}/finalize", {}, user_id=user_id)

    # Link reference to paper via PATCH
    await km_patch(
        f"/api/references/{reference_id}",
        {"paperId": paper_id},
        user_id=user_id,
    )

    return {
        "success": True,
        "paper_id": paper_id,
        "open_button_payload": {"paperId": paper_id, "route": f"/papers/{paper_id}"},
    }


agentic_fetch_papers.metadata = {"require_approval": True}

TOOLS = [agentic_search_papers, agentic_fetch_papers]