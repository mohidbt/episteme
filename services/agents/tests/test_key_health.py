"""Tests for lib.key_health — global fallback API key exhaustion notifier.

Covers classification of provider HTTP errors, dedup window for
last_alerted_at, and the 429 rate-limit threshold semantics. The asyncpg
connection and httpx (Resend) client are mocked — no Postgres or network.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

from lib import key_health as kh  # noqa: E402


# ---------- classify_provider_error ----------


def test_classify_401_invalid_key():
    assert kh.classify_provider_error(401, "invalid api key") == "key_invalid"


def test_classify_402_exhausted():
    assert kh.classify_provider_error(402, "insufficient_quota") == "key_exhausted"


def test_classify_403_balance_text_treated_as_exhausted():
    assert (
        kh.classify_provider_error(403, "insufficient credits to make this request")
        == "key_exhausted"
    )


def test_classify_403_non_quota_returns_none():
    assert kh.classify_provider_error(403, "forbidden region") is None


def test_classify_429_rate_limited():
    assert kh.classify_provider_error(429, "rate limit") == "key_rate_limited"


def test_classify_400_returns_none():
    assert kh.classify_provider_error(400, "bad request") is None


def test_classify_500_returns_none():
    assert kh.classify_provider_error(500, "boom") is None


def test_classify_200_returns_none():
    assert kh.classify_provider_error(200, "") is None


# ---------- record_and_maybe_alert ----------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row(
    *,
    hit_count: int,
    first_seen_at: datetime,
    last_alerted_at: datetime | None,
) -> dict[str, Any]:
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "hit_count": hit_count,
        "first_seen_at": first_seen_at,
        "last_seen_at": _now(),
        "last_alerted_at": last_alerted_at,
    }


class _FakeResendResponse:
    def __init__(self, status: int = 200):
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"resend {self.status_code}")

    def json(self):
        return {"id": "msg_test"}


class _FakeHttpxClient:
    def __init__(self, status: int = 200):
        self.status = status
        self.posts: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.posts.append({"url": url, "headers": headers, "json": json})
        return _FakeResendResponse(self.status)


@pytest.fixture
def resend_env(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_123")
    monkeypatch.setenv("ALERT_EMAIL_TO", "alerts@example.com")


@pytest.fixture
def fake_pool():
    """Returns (pool, conn) — pool.acquire() yields conn (async context)."""
    conn = AsyncMock()

    class _PoolCtx:
        async def __aenter__(self):
            return conn

        async def __aexit__(self, *a):
            return False

    pool = AsyncMock()
    pool.acquire = lambda: _PoolCtx()
    return pool, conn


@pytest.mark.asyncio
async def test_key_invalid_first_hit_sends_alert(resend_env, fake_pool):
    pool, conn = fake_pool
    conn.fetchrow.return_value = _row(
        hit_count=1, first_seen_at=_now(), last_alerted_at=None
    )
    fake = _FakeHttpxClient()
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            pool,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_invalid",
            sample_error="401 invalid",
        )

    assert sent is True
    # UPSERT must reference the partial-index predicate
    upsert_sql = conn.fetchrow.call_args.args[0]
    assert "ON CONFLICT" in upsert_sql
    assert "cleared_at IS NULL" in upsert_sql
    # Mark-alerted UPDATE issued
    assert any("last_alerted_at" in c.args[0] for c in conn.execute.call_args_list)
    # Email POST
    assert len(fake.posts) == 1
    body = fake.posts[0]["json"]
    assert body["to"] == ["alerts@example.com"]
    assert "EPISTEME_SHARED_LLM_KEY" in body["subject"]
    assert "openrouter" in body["subject"]
    assert "key_invalid" in body["subject"]


@pytest.mark.asyncio
async def test_key_invalid_dedup_within_hour_no_alert(resend_env, fake_pool):
    pool, conn = fake_pool
    conn.fetchrow.return_value = _row(
        hit_count=4,
        first_seen_at=_now() - timedelta(minutes=30),
        last_alerted_at=_now() - timedelta(minutes=20),
    )
    fake = _FakeHttpxClient()
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            pool,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_invalid",
            sample_error="401",
        )

    assert sent is False
    assert fake.posts == []
    # When suppressed, last_alerted_at must NOT be touched.
    for c in conn.execute.call_args_list:
        assert "last_alerted_at" not in c.args[0]


@pytest.mark.asyncio
async def test_key_invalid_dedup_after_hour_alerts_again(resend_env, fake_pool):
    pool, conn = fake_pool
    conn.fetchrow.return_value = _row(
        hit_count=12,
        first_seen_at=_now() - timedelta(hours=3),
        last_alerted_at=_now() - timedelta(hours=2),
    )
    fake = _FakeHttpxClient()
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            pool,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_invalid",
            sample_error="401",
        )

    assert sent is True
    assert len(fake.posts) == 1


@pytest.mark.asyncio
async def test_429_below_threshold_no_alert(resend_env, fake_pool):
    pool, conn = fake_pool
    conn.fetchrow.return_value = _row(
        hit_count=3, first_seen_at=_now() - timedelta(minutes=2), last_alerted_at=None
    )
    fake = _FakeHttpxClient()
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            pool,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_rate_limited",
            sample_error="429",
        )

    assert sent is False
    assert fake.posts == []
    for c in conn.execute.call_args_list:
        assert "last_alerted_at" not in c.args[0]


@pytest.mark.asyncio
async def test_429_threshold_hit_alerts(resend_env, fake_pool):
    pool, conn = fake_pool
    conn.fetchrow.return_value = _row(
        hit_count=5, first_seen_at=_now() - timedelta(minutes=4), last_alerted_at=None
    )
    fake = _FakeHttpxClient()
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            pool,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_rate_limited",
            sample_error="429",
        )

    assert sent is True
    assert len(fake.posts) == 1


@pytest.mark.asyncio
async def test_resend_http_failure_leaves_last_alerted_at_unmarked(
    resend_env, fake_pool
):
    pool, conn = fake_pool
    conn.fetchrow.return_value = _row(
        hit_count=1, first_seen_at=_now(), last_alerted_at=None
    )
    fake = _FakeHttpxClient(status=500)
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            pool,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_invalid",
            sample_error="401",
        )

    assert sent is False
    # Resend was attempted, but the row must NOT be marked alerted so the
    # next provider error retries naturally.
    assert len(fake.posts) == 1
    for c in conn.execute.call_args_list:
        assert "last_alerted_at" not in c.args[0]


@pytest.mark.asyncio
async def test_no_resend_key_means_no_post_but_still_records(monkeypatch, fake_pool):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("ALERT_EMAIL_TO", "alerts@example.com")
    pool, conn = fake_pool
    conn.fetchrow.return_value = _row(
        hit_count=1, first_seen_at=_now(), last_alerted_at=None
    )
    fake = _FakeHttpxClient()
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            pool,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_invalid",
            sample_error="401",
        )

    # DB row recorded, but no email (silent in dev/preview).
    conn.fetchrow.assert_awaited()
    assert sent is False
    assert fake.posts == []


@pytest.mark.asyncio
async def test_pool_none_is_safe_noop(resend_env):
    # Boot-time / early-failure path: pool may not be initialised.
    fake = _FakeHttpxClient()
    with patch("lib.key_health.httpx.AsyncClient", lambda *a, **kw: fake):
        sent = await kh.record_and_maybe_alert(
            None,
            provider="openrouter",
            env_var="EPISTEME_SHARED_LLM_KEY",
            reason="key_invalid",
            sample_error="401",
        )
    assert sent is False
    assert fake.posts == []
