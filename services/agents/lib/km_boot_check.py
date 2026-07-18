"""GSD-204: boot-time validation of EPISTEME_KM_BASE_URL.

A KM domain change once left EPISTEME_KM_BASE_URL pointing at a bare-apex host
that 308-redirects to the canonical host. Because km_get/km_post use
`follow_redirects=False` (the redirect hop drops the HMAC X-Inhale-* headers,
so following it is NOT the fix), every agent /invoke 500'd at runtime.

This module asserts the config at startup so a misconfiguration fails LOUD at
boot instead of surfacing as a runtime 500. The correct fix is always to point
the env var at the final (non-redirecting) host.

"Deployed" is detected by the presence of EPISTEME_AGENTS_PG_URL — the same
signal app.py's lifespan uses to switch from in-memory dev stores to the
Postgres saver/store. Local dev (no PG url) skips all checks.
"""
import logging
import os
from urllib.parse import urlparse, urlunparse

import httpx

logger = logging.getLogger(__name__)

_PROBE_TIMEOUT_S = 5.0
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


class KmBaseUrlMisconfigured(RuntimeError):
    """Raised at startup when EPISTEME_KM_BASE_URL is missing, points at a
    loopback host in a deployed environment, is malformed, or redirects."""


def _is_deployed() -> bool:
    """True when running in a deployed environment (prod/preview), matching the
    EPISTEME_AGENTS_PG_URL gate app.py already uses. Local dev has no PG url."""
    return bool(os.environ.get("EPISTEME_AGENTS_PG_URL"))


def _redact(url: str) -> str:
    """Strip userinfo (user:pass@) from a URL so credentials never reach boot
    logs or exceptions (public repo, deployed environment)."""
    try:
        p = urlparse(url)
    except ValueError:
        return "<redacted>"
    if not p.hostname:
        return url  # not URL-shaped; nothing to redact
    netloc = p.hostname
    if p.port:
        netloc = f"{netloc}:{p.port}"
    return urlunparse((p.scheme, netloc, p.path, p.params, p.query, p.fragment))


async def validate_km_base_url(client: httpx.AsyncClient | None) -> None:
    """Validate EPISTEME_KM_BASE_URL at boot.

    Local dev (no EPISTEME_AGENTS_PG_URL): no-op — localhost is expected.

    Deployed:
      1. EPISTEME_KM_BASE_URL must be set, non-loopback, and URL-shaped (fatal).
      2. Best-effort probe: HEAD the base URL; if it returns a 3xx redirect,
         fail loud — km_get/km_post don't follow redirects, so this would 500
         every /invoke. Transport/network errors on the probe are non-fatal
         (the shape checks already passed and the probe is diagnostic only);
         malformed/unsupported URLs remain fatal.
    """
    if not _is_deployed():
        return

    base_url = os.environ.get("EPISTEME_KM_BASE_URL", "").strip()
    if not base_url:
        raise KmBaseUrlMisconfigured(
            "EPISTEME_KM_BASE_URL is not set in a deployed environment. "
            "Set it to the final KM host, e.g. https://app.tryepisteme.com"
        )

    safe = _redact(base_url)
    parsed = urlparse(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise KmBaseUrlMisconfigured(
            f"EPISTEME_KM_BASE_URL is malformed ({safe}) — expected a full "
            "http(s) URL, e.g. https://app.tryepisteme.com"
        )

    host = parsed.hostname.lower()
    if host in _LOOPBACK_HOSTS:
        raise KmBaseUrlMisconfigured(
            f"EPISTEME_KM_BASE_URL points at a loopback/localhost host ({safe}) "
            "in a deployed environment. Set it to the final KM host, e.g. "
            "https://app.tryepisteme.com"
        )

    if client is None:
        return

    try:
        resp = await client.head(base_url, timeout=_PROBE_TIMEOUT_S)
    except (httpx.InvalidURL, httpx.UnsupportedProtocol, ValueError) as exc:
        # A malformed/unsupported base URL (missing scheme, ftp://, ...) is a
        # hard config error — surface the actionable message rather than let it
        # slip through the non-fatal transport-error branch below.
        raise KmBaseUrlMisconfigured(
            f"EPISTEME_KM_BASE_URL is malformed ({safe}): {type(exc).__name__}. "
            "Set it to a full http(s) URL, e.g. https://app.tryepisteme.com"
        ) from exc
    except httpx.HTTPError as exc:
        # Best-effort: the KM host may be cold/slow at our boot. The config
        # shape already validated; don't block startup on a transient error.
        logger.warning(
            "KM base URL startup probe failed (non-fatal): %s", type(exc).__name__
        )
        return

    if 300 <= resp.status_code < 400:
        location = _redact(resp.headers.get("location", "") or "<unknown>")
        raise KmBaseUrlMisconfigured(
            f"EPISTEME_KM_BASE_URL redirects ({resp.status_code} -> "
            f"{location}) — update EPISTEME_KM_BASE_URL to the final host. "
            "km_get/km_post do not follow redirects (the hop drops the HMAC "
            "X-Inhale-* headers), so this would 500 every agent /invoke."
        )
