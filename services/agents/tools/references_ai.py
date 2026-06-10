"""LangChain tools for reference enrichment in apps/km.

* ``fill_reference(ref_id, fields)``: fetch reference → ask the KM
  ``/api/ai-fill`` route to suggest values for the missing fields →
  PATCH the reference with the merged cslJson. Single-ref version of
  the UI's "Fill all missing" batch action.

* ``resolve_doi(doi)``: hit the cached CrossRef proxy. Strips
  ``https://doi.org/`` (and ``http://``) prefixes and lowercases so
  callers don't need to normalise.

The authenticated user_id is injected at runtime via ``RunnableConfig``
(``configurable.user_id``) — never accepted from the LLM.
"""
from urllib.parse import quote

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from lib.km_http import km_get, km_patch, km_post
from tools._auth import user_id_from_config


def _normalize_doi(doi: str) -> str:
    """Strip URL prefix, whitespace, and lowercase."""
    s = doi.strip()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi.org/"):
        if s.lower().startswith(prefix):
            s = s[len(prefix):]
            break
    return s.lower()


@tool
async def resolve_doi(doi: str, *, config: RunnableConfig) -> object:
    """Resolve a DOI to CSL JSON via CrossRef (cached server-side).

    Accepts bare DOIs (``10.1234/abc``) or full URLs
    (``https://doi.org/10.1234/abc``); the tool normalises before
    querying. Returns the structured error dict on 404 (DOI not found).

    Args:
        doi: DOI string in any form.
    """
    user_id = user_id_from_config(config)
    normalized = _normalize_doi(doi)
    return await km_get(f"/api/doi/{quote(normalized, safe='')}", user_id=user_id)


@tool
async def fill_reference(
    ref_id: str, fields: list[str], *, config: RunnableConfig
) -> object:
    """Auto-fill missing metadata fields on a single reference row.

    Pipeline: GET the reference's current cslJson → POST it to the KM
    ``/api/ai-fill`` route alongside the missing field list → merge the
    suggestion into the cslJson → PATCH it back.

    Args:
        ref_id: Reference UUID.
        fields: List of CSL-style field names to fill (e.g.
            ``["year", "abstract", "author"]``).
    """
    user_id = user_id_from_config(config)
    ref = await km_get(f"/api/references/{quote(ref_id, safe='')}", user_id=user_id)
    if isinstance(ref, dict) and ref.get("error"):
        return ref

    known = ref.get("cslJson") if isinstance(ref, dict) else None
    if not isinstance(known, dict):
        known = {}

    suggestion = await km_post(
        "/api/ai-fill",
        {"kind": "reference", "known": known, "missing": fields},
        user_id=user_id,
    )
    if isinstance(suggestion, dict) and suggestion.get("error"):
        return suggestion

    merged = {**known, **(suggestion if isinstance(suggestion, dict) else {})}
    patched = await km_patch(
        f"/api/references/{quote(ref_id, safe='')}",
        {"cslJson": merged},
        user_id=user_id,
    )
    if isinstance(patched, dict) and patched.get("error"):
        return {"ok": False, "suggestion": suggestion, "patch_error": patched}
    return {"ok": True, "suggestion": suggestion, "reference": patched}


TOOLS = [fill_reference, resolve_doi]
