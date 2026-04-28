"""Pytest fixtures for the Phase 1.3b E2E suite.

Run from repo root:
    pytest temp/e2e-1.3b-agents -v -p no:cacheprovider

Required env vars (read README.md for full list):
    EPISTEME_AGENTS_PG_URL
    INHALE_INTERNAL_SECRET
    INHALE_LLM_KEY (optional; tests that need it skip when unset)
    AGENTS_BASE_URL  (default http://localhost:8000)
    KM_BASE_URL      (default http://localhost:3001)
    READER_BASE_URL  (default http://localhost:3000)
"""
from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import asyncpg
import httpx
import pytest
import pytest_asyncio


# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

REQUIRED_ENV = ("EPISTEME_AGENTS_PG_URL", "INHALE_INTERNAL_SECRET")


def pytest_collection_modifyitems(config, items):
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        skip = pytest.mark.skip(reason=f"missing env: {missing}")
        for item in items:
            item.add_marker(skip)


# ---------------------------------------------------------------------------
# Bases
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def agents_base() -> str:
    return os.environ.get("AGENTS_BASE_URL", "http://localhost:8000")


@pytest.fixture(scope="session")
def km_base() -> str:
    return os.environ.get("KM_BASE_URL", "http://localhost:3001")


@pytest.fixture(scope="session")
def reader_base() -> str:
    return os.environ.get("READER_BASE_URL", "http://localhost:3000")


@pytest.fixture(scope="session")
def hmac_secret() -> str:
    return os.environ["INHALE_INTERNAL_SECRET"]


@pytest.fixture(scope="session")
def llm_key() -> str | None:
    return os.environ.get("INHALE_LLM_KEY")


def needs_llm(llm_key):
    if not llm_key:
        pytest.skip("INHALE_LLM_KEY not set — LLM-driven scenario skipped")


# ---------------------------------------------------------------------------
# DB pool
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def db_pool() -> AsyncIterator[asyncpg.Pool]:
    # Function-scoped: pytest-asyncio creates a new event loop per test, and an
    # asyncpg.Pool is bound to its creation loop. Session scope causes
    # "Future attached to a different loop" errors on the second test that uses it.
    pool = await asyncpg.create_pool(os.environ["EPISTEME_AGENTS_PG_URL"], min_size=1, max_size=4)
    try:
        yield pool
    finally:
        await pool.close()


# ---------------------------------------------------------------------------
# Per-test user
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def test_user() -> AsyncIterator[dict]:
    """Create a fresh user + library + clean up at teardown.

    Schema: "user" (quoted), libraries (integer id), no notebooks table.
    """
    user_id = f"e2e_{uuid.uuid4().hex[:8]}"

    conn = await asyncpg.connect(os.environ["EPISTEME_AGENTS_PG_URL"])
    try:
        await conn.execute(
            'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
            user_id,
            f"E2E {user_id[:8]}",
            f"{user_id}@e2e.test",
        )
        row = await conn.fetchrow(
            "INSERT INTO libraries (user_id, name) VALUES ($1, $2) RETURNING id",
            user_id,
            "E2E Library",
        )
        library_id = row["id"]
    finally:
        await conn.close()

    try:
        yield {"user_id": user_id, "library_id": library_id}
    finally:
        conn = await asyncpg.connect(os.environ["EPISTEME_AGENTS_PG_URL"])
        try:
            await conn.execute("DELETE FROM notes WHERE user_id = $1", user_id)
            await conn.execute("DELETE FROM agent_configs WHERE user_id = $1", user_id)
            await conn.execute("DELETE FROM libraries WHERE user_id = $1", user_id)
            await conn.execute('DELETE FROM "user" WHERE id = $1', user_id)
        finally:
            await conn.close()


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(timeout=60.0) as client:
        yield client
