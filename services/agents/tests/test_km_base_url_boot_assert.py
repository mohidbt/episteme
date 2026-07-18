"""GSD-204: boot-time assertion that EPISTEME_KM_BASE_URL is configured
correctly, so a KM domain change that leaves the var pointing at a
308-redirecting host fails LOUD at startup instead of 500ing every agent
/invoke at runtime (km_get/km_post use follow_redirects=False).

"Deployed" is detected the same way the rest of the service detects it: by
the presence of EPISTEME_AGENTS_PG_URL (set on every deployed environment,
absent on local dev). See app.py lifespan.
"""
import httpx
import pytest

from lib.km_boot_check import KmBaseUrlMisconfigured, validate_km_base_url


def _client_returning(status_code: int) -> httpx.AsyncClient:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code,
            headers=(
                {"location": "https://app.tryepisteme.com/"}
                if 300 <= status_code < 400
                else {}
            ),
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _raising_client(exc: Exception) -> httpx.AsyncClient:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise exc

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_local_dev_skips_all_checks(monkeypatch):
    """No EPISTEME_AGENTS_PG_URL → clearly local dev. Unset/localhost URL must
    NOT raise, and no network probe fires (client is None-safe)."""
    monkeypatch.delenv("EPISTEME_AGENTS_PG_URL", raising=False)
    monkeypatch.delenv("EPISTEME_KM_BASE_URL", raising=False)
    await validate_km_base_url(client=None)


@pytest.mark.asyncio
async def test_deployed_missing_url_raises(monkeypatch):
    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgres://x")
    monkeypatch.delenv("EPISTEME_KM_BASE_URL", raising=False)
    with pytest.raises(KmBaseUrlMisconfigured, match="EPISTEME_KM_BASE_URL"):
        await validate_km_base_url(client=_client_returning(200))


@pytest.mark.asyncio
async def test_deployed_localhost_url_raises(monkeypatch):
    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgres://x")
    monkeypatch.setenv("EPISTEME_KM_BASE_URL", "http://localhost:3001")
    with pytest.raises(KmBaseUrlMisconfigured, match="localhost"):
        await validate_km_base_url(client=_client_returning(200))


@pytest.mark.asyncio
async def test_deployed_redirecting_host_raises(monkeypatch):
    """The core preventive check: a bare-apex host that 308-redirects to the
    canonical host must fail loud with a message telling the operator to point
    EPISTEME_KM_BASE_URL at the final host."""
    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgres://x")
    monkeypatch.setenv("EPISTEME_KM_BASE_URL", "https://tryepisteme.com")
    with pytest.raises(KmBaseUrlMisconfigured, match="redirect"):
        await validate_km_base_url(client=_client_returning(308))


@pytest.mark.asyncio
async def test_deployed_healthy_host_passes(monkeypatch):
    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgres://x")
    monkeypatch.setenv("EPISTEME_KM_BASE_URL", "https://app.tryepisteme.com")
    # 2xx / 4xx (no redirect) → healthy config, must not raise.
    await validate_km_base_url(client=_client_returning(200))
    await validate_km_base_url(client=_client_returning(404))


@pytest.mark.asyncio
async def test_probe_network_error_is_non_fatal(monkeypatch):
    """A transient network error on the startup probe must NOT crash boot —
    the config-shape checks already passed; the probe is best-effort."""
    monkeypatch.setenv("EPISTEME_AGENTS_PG_URL", "postgres://x")
    monkeypatch.setenv("EPISTEME_KM_BASE_URL", "https://app.tryepisteme.com")
    await validate_km_base_url(
        client=_raising_client(httpx.ConnectTimeout("boom"))
    )
