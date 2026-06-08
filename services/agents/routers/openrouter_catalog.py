"""OpenRouter model catalog cache.

Background fetcher + read endpoint backed by the openrouter_catalog table.
Frontend reads via Drizzle directly (Next.js → Postgres). This service is
responsible for *populating* the cache (24h TTL, stale-while-revalidate).
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from deps.db import ConnDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/openrouter", tags=["openrouter-catalog"])

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
TTL = timedelta(hours=24)

_refresh_in_flight = False


async def _fetch_openrouter(api_key: str | None) -> list[dict[str, Any]]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            OPENROUTER_MODELS_URL,
            params={"supported_parameters": "tools"},
            headers=headers,
        )
        if r.status_code >= 400 and api_key:
            # Catalog fetch always uses the global OPENROUTER_API_KEY (no BYOK).
            try:
                from lib.key_health import (  # noqa: PLC0415
                    classify_provider_error,
                    record_and_maybe_alert,
                )
                from deps import db as db_module  # noqa: PLC0415

                reason = classify_provider_error(r.status_code, r.text)
                if reason is not None:
                    await record_and_maybe_alert(
                        db_module._pool,
                        provider="openrouter",
                        env_var="OPENROUTER_API_KEY",
                        reason=reason,
                        sample_error=r.text[:1000],
                    )
            except Exception:  # noqa: BLE001
                logger.exception("openrouter catalog key-health notify failed")
        r.raise_for_status()
        body = r.json()
    data = body.get("data") or []
    if not isinstance(data, list):
        raise ValueError("openrouter /models did not return a data array")
    return data


async def refresh_catalog(conn, api_key: str | None = None) -> int:
    """Fetch OpenRouter and upsert into openrouter_catalog. Returns count."""
    entries = await _fetch_openrouter(api_key)
    if not entries:
        return 0
    now = datetime.utcnow()
    rows = [
        (entry["id"], entry, now)
        for entry in entries
        if isinstance(entry, dict) and entry.get("id")
    ]
    await conn.executemany(
        "INSERT INTO openrouter_catalog (model_id, payload, fetched_at) "
        "VALUES ($1, $2::jsonb, $3) "
        "ON CONFLICT (model_id) DO UPDATE SET "
        "payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at",
        [(mid, json.dumps(payload), ts) for (mid, payload, ts) in rows],
    )
    return len(rows)


async def _bg_refresh() -> None:
    """Background refresh — opens its own connection from the pool.

    Module-level _refresh_in_flight flag prevents concurrent OpenRouter fetches
    when many stale GETs land in the same window.
    """
    global _refresh_in_flight
    if _refresh_in_flight:
        return
    from deps import db as db_module  # noqa: PLC0415
    if db_module._pool is None:
        return
    _refresh_in_flight = True
    api_key = os.environ.get("OPENROUTER_API_KEY")
    try:
        async with db_module._pool.acquire() as conn:
            count = await refresh_catalog(conn, api_key)
        logger.info("openrouter catalog background refresh: %d rows", count)
    except Exception:
        logger.exception("openrouter catalog background refresh failed")
    finally:
        _refresh_in_flight = False


def _is_stale(oldest: datetime | None) -> bool:
    if oldest is None:
        return True
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - oldest > TTL


@router.get("/catalog")
async def get_catalog(conn: ConnDep) -> dict[str, Any]:
    rows = await conn.fetch(
        "SELECT payload, fetched_at FROM openrouter_catalog ORDER BY fetched_at DESC"
    )
    models = []
    newest: datetime | None = None
    oldest: datetime | None = None
    for r in rows:
        payload = r["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        models.append(payload)
        ts = r["fetched_at"]
        if newest is None or ts > newest:
            newest = ts
        if oldest is None or ts < oldest:
            oldest = ts

    if not rows or _is_stale(oldest):
        # Stale-while-revalidate: respond now, refresh in the background.
        try:
            asyncio.create_task(_bg_refresh())
        except RuntimeError:
            # No running loop (shouldn't happen under FastAPI), skip.
            pass

    return {
        "models": models,
        "fetched_at": newest.isoformat() if newest else None,
    }


@router.post("/catalog/refresh")
async def post_refresh(conn: ConnDep) -> dict[str, Any]:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    try:
        count = await refresh_catalog(conn, api_key)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"openrouter fetch failed: {e}") from e
    return {"count": count, "fetched_at": datetime.now(timezone.utc).isoformat()}
