"""
Chandra OCR helpers — reusable lib for routers/tools.

Extracted from routers/chandra_segments.py (1.4.x T2). The original module
docstring describing the Chandra/Marker JSON shape, block_type → kind mapping,
and payload schema lives in the router file (kept there to avoid bit-rot of
duplicated docs).

This module exposes:
  - run_chandra(file_path, api_key)        — async Datalab convert call.
  - parse_blocks(json_output)              — flatten Marker JSON to rows.
  - insert_segments(conn, paper_id, rows) — bulk INSERT into document_segments.
  - ensure_parsed(paper_id, conn, ocr_key) — lazy-trigger w/ compare-and-set
                                              on papers.chandra_status.
  - ChandraParseFailed                     — raised when Chandra fails OR
                                              another worker left status='failed'.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from typing import Any, Literal

logger = logging.getLogger(__name__)

# Maps Chandra block_type → document_segments.kind
_KIND_MAP: dict[str, str] = {
    "SectionHeader": "section_header",
    "Picture": "figure",
    "Figure": "figure",
    "Equation": "formula",
    "Formula": "formula",
    "Table": "table",
    "Text": "paragraph",
    "TextInlineMath": "paragraph",
}


class ChandraParseFailed(Exception):
    """Raised when Chandra OCR fails or papers.chandra_status is 'failed'."""


class ChandraContractError(ChandraParseFailed):
    """Hard non-retryable data contract violation."""


class ChandraSourceAccessError(ChandraParseFailed):
    """Retryable/transient failure accessing source objects."""


def _strip_html(raw: str) -> str:
    """Remove HTML tags, unescape HTML entities, and return plain text."""
    return html.unescape(re.sub(r"<[^>]+>", "", raw or "").strip())


def _page_index_from_id(block_id: str) -> int:
    """Extract page number from Marker block ID like '/page/0/SectionHeader/0'."""
    parts = block_id.split("/")
    try:
        idx = parts.index("page")
        return int(parts[idx + 1])
    except (ValueError, IndexError):
        logger.warning("Could not parse page index from block id %s", block_id)
        return 0


def _build_payload(kind: str, block: dict[str, Any]) -> dict[str, Any]:
    raw_html = block.get("html", "")
    text = _strip_html(raw_html)
    if kind == "section_header":
        m = re.search(r"<h([1-6])[^>]*>", raw_html, re.IGNORECASE)
        heading_level = int(m.group(1)) if m else None
        return {"text": text, "heading_level": heading_level}
    if kind == "figure":
        return {"caption": text}
    if kind == "formula":
        return {"latex": raw_html}
    if kind == "table":
        return {"html": raw_html}
    return {"text": text}


def _normalized_bbox(bbox: list[float], page_w: float, page_h: float) -> dict[str, float]:
    x0, y0, x1, y1 = bbox[0], bbox[1], bbox[2], bbox[3]
    return {
        "x0": x0 / page_w,
        "y0": y0 / page_h,
        "x1": x1 / page_w,
        "y1": y1 / page_h,
    }


def _page_dims(page_block: dict[str, Any]) -> tuple[float, float] | None:
    page_bbox = page_block.get("bbox")
    if not page_bbox or len(page_bbox) < 4:
        return None
    w = page_bbox[2] - page_bbox[0]
    h = page_bbox[3] - page_bbox[1]
    if w <= 0 or h <= 0:
        return None
    return w, h


def parse_blocks(json_output: dict[str, Any]) -> list[tuple[int, str, dict, dict]]:
    """
    Parse the Marker JSON tree into a flat list of
    (page_index, kind, bbox_dict, payload_dict) tuples in page-major order.
    """
    rows: list[tuple[int, str, dict, dict]] = []
    pages = json_output.get("children", [])

    for page_block in pages:
        if page_block.get("block_type") != "Page":
            continue
        dims = _page_dims(page_block)
        if dims is None:
            logger.warning("Skipping page without usable bbox: %s", page_block.get("id"))
            continue
        page_w, page_h = dims
        page_id = page_block.get("id", "/page/0/Page/0")
        page_num = _page_index_from_id(page_id)

        for block in page_block.get("children", []):
            kind = _KIND_MAP.get(block.get("block_type", ""))
            if not kind:
                continue
            raw_bbox = block.get("bbox")
            if not raw_bbox or len(raw_bbox) < 4:
                continue
            bbox = _normalized_bbox(raw_bbox, page_w, page_h)
            payload = _build_payload(kind, block)
            rows.append((page_num, kind, bbox, payload))

    return rows


async def _maybe_notify_datalab_exhaustion(exc: Exception) -> None:
    """Best-effort notify when the global DATALAB_API_KEY is exhausted/invalid.

    Datalab SDK surfaces HTTP errors as plain exceptions whose `str()` carries
    the status. We parse loosely (no SDK error-class import) so this stays
    resilient to datalab_sdk version drift.
    """
    msg = str(exc)
    low = msg.lower()
    if "401" in low or "unauthorized" in low or "invalid api key" in low:
        status = 401
    elif "402" in low or "payment" in low or "insufficient" in low or "credit" in low:
        status = 402
    elif "429" in low or "rate limit" in low:
        status = 429
    else:
        return
    try:
        from lib.key_health import (  # noqa: PLC0415
            classify_provider_error,
            record_and_maybe_alert,
        )
        from deps import db as db_module  # noqa: PLC0415

        reason = classify_provider_error(status, msg)
        if reason is None:
            return
        await record_and_maybe_alert(
            db_module._pool,
            provider="chandra",
            env_var="DATALAB_API_KEY",
            reason=reason,
            sample_error=msg[:1000],
        )
    except Exception:  # noqa: BLE001
        logger.exception("chandra key-health notify failed")


async def run_chandra(file_path: str, api_key: str):
    """Call Chandra OCR asynchronously via AsyncDatalabClient."""
    from datalab_sdk import AsyncDatalabClient, ConvertOptions

    api_key = (api_key or "").strip()
    logger.info(
        "chandra: invoking AsyncDatalabClient (key_len=%d, key_prefix=%r)",
        len(api_key),
        api_key[:4] if api_key else "",
    )
    try:
        async with AsyncDatalabClient(api_key=api_key) as chandra:
            return await chandra.convert(
                file_path=file_path,
                options=ConvertOptions(output_format="json", mode="balanced"),
                max_polls=120,
            )
    except Exception as exc:
        # Datalab key is always the global env DATALAB_API_KEY — no BYOK.
        await _maybe_notify_datalab_exhaustion(exc)
        raise


async def insert_segments(
    conn,
    paper_id: str,
    rows: list[tuple[int, str, dict, dict]],
) -> None:
    """Bulk INSERT parsed rows into document_segments."""
    if not rows:
        return
    await conn.executemany(
        """
        INSERT INTO document_segments
          (paper_id, page, kind, bbox, payload, order_index)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        [
            (
                paper_id,
                page,
                kind,
                json.dumps(bbox),
                json.dumps(payload),
                idx,
            )
            for idx, (page, kind, bbox, payload) in enumerate(rows)
        ],
    )


# ---------------------------------------------------------------------------
# ensure_parsed: lazy-trigger Chandra with compare-and-set deduping.
# ---------------------------------------------------------------------------

# Tunables (module-level so tests can monkeypatch).
POLL_INTERVAL_SECONDS: float = 1.0
POLL_TIMEOUT_SECONDS: float = 60.0


async def ensure_parsed(
    paper_id: str,
    conn,
    ocr_key: str,
) -> Literal["done", "failed"]:
    """
    Ensure a paper has been parsed by Chandra. Idempotent + parallel-safe.

    Behavior:
      - status='done'     → return 'done' immediately (no-op).
      - status='failed'   → raise ChandraParseFailed (caller decides retry policy).
      - status='running'  → poll every POLL_INTERVAL_SECONDS until 'done' / 'failed'
                            or POLL_TIMEOUT_SECONDS expires.
      - status='pending'  → atomic CAS to 'running'. Winner runs Chandra +
                            INSERTs segments + sets 'done'. Loser polls.
    On Chandra error: status set to 'failed' and ChandraParseFailed raised.

    Returns 'done' on success. Never returns 'failed' — failures raise.
    """
    # 1. Read current status + storage_url in one round-trip.
    row = await conn.fetchrow(
        "SELECT chandra_status, storage_url FROM papers WHERE id = $1",
        paper_id,
    )
    if row is None:
        raise ChandraParseFailed(f"paper {paper_id} not found")

    status = row["chandra_status"]
    storage_url = row["storage_url"]

    if status == "done":
        return "done"
    if status == "failed":
        raise ChandraParseFailed(f"paper {paper_id} chandra_status='failed'")

    # 2. Compare-and-set: try to claim from pending OR failed.
    # (We already short-circuited 'failed' above, but include it so a future
    # explicit retry path can reset status='pending' and call us again.)
    won = await conn.fetchval(
        """
        UPDATE papers
           SET chandra_status = 'running'
         WHERE id = $1
           AND chandra_status IN ('pending', 'failed')
        RETURNING id
        """,
        paper_id,
    )

    if won is None:
        # Another worker is running. Poll until terminal.
        return await _poll_until_terminal(paper_id, conn)

    # 3. We won the CAS. Run Chandra + insert + mark done. On any error: mark failed.
    try:
        from lib.storage import download_to_tempfile, object_exists, paperSourceKey

        if not storage_url:
            canonical_key = paperSourceKey(paper_id)
            try:
                exists = await object_exists(canonical_key)
            except Exception as exc:
                raise ChandraSourceAccessError(
                    f"paper {paper_id} storage lookup failed for canonical key {canonical_key}: {exc!r}"
                ) from exc
            if not exists:
                raise ChandraContractError(
                    f"paper {paper_id} missing storage_url and canonical source object {canonical_key} not found"
                )
            storage_url = canonical_key

        async with download_to_tempfile(storage_url) as local_path:
            result = await run_chandra(local_path, ocr_key)
        if not result.success or result.json is None:
            raise ChandraParseFailed(
                f"chandra convert failed for paper {paper_id}: {getattr(result, 'error', None)}"
            )

        rows = parse_blocks(result.json)
        await insert_segments(conn, paper_id, rows)

        await conn.execute(
            """
            UPDATE papers
               SET chandra_status = 'done',
                   chandra_completed_at = now()
             WHERE id = $1
            """,
            paper_id,
        )
        return "done"
    except Exception as exc:
        if isinstance(exc, ChandraSourceAccessError):
            await conn.execute(
                "UPDATE papers SET chandra_status = 'pending' WHERE id = $1",
                paper_id,
            )
            raise
        await conn.execute(
            "UPDATE papers SET chandra_status = 'failed' WHERE id = $1",
            paper_id,
        )
        if isinstance(exc, ChandraParseFailed):
            raise
        raise ChandraParseFailed(
            f"chandra parse raised for paper {paper_id}: {exc!r}"
        ) from exc


async def _poll_until_terminal(paper_id: str, conn) -> Literal["done", "failed"]:
    """Poll papers.chandra_status until 'done' or 'failed' or timeout."""
    elapsed = 0.0
    while elapsed < POLL_TIMEOUT_SECONDS:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        elapsed += POLL_INTERVAL_SECONDS
        status = await conn.fetchval(
            "SELECT chandra_status FROM papers WHERE id = $1",
            paper_id,
        )
        if status == "done":
            return "done"
        if status == "failed":
            raise ChandraParseFailed(
                f"paper {paper_id} chandra_status='failed' (observed during poll)"
            )
    # Timed out — surface as failure so caller doesn't silently swallow.
    raise ChandraParseFailed(
        f"paper {paper_id} chandra parse did not finish within {POLL_TIMEOUT_SECONDS}s"
    )
