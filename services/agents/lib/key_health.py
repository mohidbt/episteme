"""Global fallback API key exhaustion notifier.

Single chokepoint called by provider clients (openrouter, tavily,
semantic_scholar, chandra) when a request using a *fallback* env-var key
returns 401, 402, or sustained 429. UPSERTs into `provider_key_alerts`
(shared with apps/km TS notifier) and emails the operator via Resend when
the per-row dedup window has elapsed.

BYOK (per-user) key failures must NOT call this — only env-fallback paths.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

Reason = Literal["key_invalid", "key_exhausted", "key_rate_limited"]

DEDUP_WINDOW = timedelta(hours=1)
RATE_LIMIT_THRESHOLD_HITS = 5
RATE_LIMIT_WINDOW = timedelta(minutes=10)

_QUOTA_HINTS = (
    "insufficient_quota",
    "insufficient credit",
    "insufficient credits",
    "payment_required",
    "out of credit",
    "balance",
    "quota exceeded",
    "credit limit",
    "key limit",
    "more credits",
    "fewer max_tokens",
)


def classify_provider_error(status_code: int, body_text: str) -> Reason | None:
    """Map an HTTP status + response body to an alert reason, or None.

    GSD-136: OR returns HTTP 401 (NOT 402) when a Provisioning-API key has
    its `limit` exhausted. The body carries a "more credits" / "credit
    limit" quota hint. We disambiguate by body content: hint present →
    key_exhausted, hint absent → key_invalid (real auth failure).
    """
    body = (body_text or "").lower()
    has_quota_hint = any(h in body for h in _QUOTA_HINTS)
    if status_code == 401:
        return "key_exhausted" if has_quota_hint else "key_invalid"
    if status_code == 402:
        return "key_exhausted"
    if status_code == 403 and has_quota_hint:
        return "key_exhausted"
    if status_code == 429:
        return "key_rate_limited"
    return None


_UPSERT_SQL = """
INSERT INTO provider_key_alerts (provider, env_var, reason, hit_count, sample_error)
VALUES ($1, $2, $3, 1, $4)
ON CONFLICT (provider, env_var, reason) WHERE cleared_at IS NULL
DO UPDATE SET
  hit_count = CASE
    WHEN $3 = 'key_rate_limited'
         AND provider_key_alerts.first_seen_at < NOW() - INTERVAL '10 minutes'
    THEN 1
    ELSE provider_key_alerts.hit_count + 1
  END,
  first_seen_at = CASE
    WHEN $3 = 'key_rate_limited'
         AND provider_key_alerts.first_seen_at < NOW() - INTERVAL '10 minutes'
    THEN NOW()
    ELSE provider_key_alerts.first_seen_at
  END,
  last_seen_at = NOW(),
  sample_error = COALESCE(EXCLUDED.sample_error, provider_key_alerts.sample_error)
RETURNING id, hit_count, first_seen_at, last_seen_at, last_alerted_at
"""

_MARK_ALERTED_SQL = (
    "UPDATE provider_key_alerts SET last_alerted_at = NOW() WHERE id = $1"
)


def _should_alert(reason: Reason, row: dict[str, Any]) -> bool:
    last_alerted = row.get("last_alerted_at")
    now = datetime.now(timezone.utc)
    if last_alerted is not None and now - last_alerted < DEDUP_WINDOW:
        return False
    if reason == "key_rate_limited":
        first_seen = row.get("first_seen_at")
        if first_seen is None or now - first_seen > RATE_LIMIT_WINDOW:
            return False
        if row.get("hit_count", 0) < RATE_LIMIT_THRESHOLD_HITS:
            return False
    return True


async def _send_resend_email(
    *,
    provider: str,
    env_var: str,
    reason: Reason,
    row: dict[str, Any],
    sample_error: str | None,
) -> bool:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        logger.warning(
            "provider key alert suppressed — RESEND_API_KEY unset "
            "(provider=%s env=%s reason=%s)",
            provider,
            env_var,
            reason,
        )
        return False
    to_addr = os.environ.get("ALERT_EMAIL_TO", "mohidfbutt@gmail.com").strip()
    from_addr = os.environ.get(
        "ALERT_EMAIL_FROM", "alerts@tryepisteme.com"
    ).strip()

    subject = f"[episteme] {provider} key {reason} — {env_var}"
    body_lines = [
        f"Provider: {provider}",
        f"Env var: {env_var}",
        f"Reason: {reason}",
        f"Hit count (since first_seen): {row.get('hit_count')}",
        f"First seen: {row.get('first_seen_at')}",
        f"Last seen: {row.get('last_seen_at')}",
        f"Last alerted: {row.get('last_alerted_at')}",
        "",
        "Sample error:",
        (sample_error or "").strip()[:1000],
    ]
    payload = {
        "from": from_addr,
        "to": [to_addr],
        "subject": subject,
        "text": "\n".join(body_lines),
    }
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            r.raise_for_status()
    except Exception:
        logger.exception(
            "resend POST failed (provider=%s env=%s)", provider, env_var
        )
        return False
    return True


async def record_and_maybe_alert(
    pool: Any,
    *,
    provider: str,
    env_var: str,
    reason: Reason,
    sample_error: str | None = None,
) -> bool:
    """UPSERT alert row + email operator if dedup window allows.

    Returns True iff a Resend email was successfully sent on this call.
    Safe to call from any provider error handler — never raises.
    """
    if pool is None:
        return False
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                _UPSERT_SQL, provider, env_var, reason, sample_error
            )
            if row is None:
                return False
            row_dict = dict(row)
            if not _should_alert(reason, row_dict):
                return False
            sent = await _send_resend_email(
                provider=provider,
                env_var=env_var,
                reason=reason,
                row=row_dict,
                sample_error=sample_error,
            )
            if sent:
                await conn.execute(_MARK_ALERTED_SQL, row_dict["id"])
            return sent
    except Exception:
        logger.exception(
            "record_and_maybe_alert failed (provider=%s env=%s reason=%s)",
            provider,
            env_var,
            reason,
        )
        return False
