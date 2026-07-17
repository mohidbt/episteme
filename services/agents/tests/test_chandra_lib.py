"""
Tests for services/agents/lib/chandra.py (1.4.x T2).

Covers:
  - parse_blocks / run_chandra re-export (regression: same behavior as router).
  - ensure_parsed:
    * status='done'  → no-op.
    * status='failed' → ChandraParseFailed.
    * pending → wins CAS → run_chandra → insert_segments → status='done'.
    * concurrent callers → exactly ONE run_chandra call (CAS dedup).
    * run_chandra raises → status='failed', ChandraParseFailed propagated.

DB connection is mocked at the same boundary the router tests use
(AsyncMock with .fetchrow / .fetchval / .execute / .executemany).
A live integration test against the real DB is deferred until migration
0021 is applied to the dev DB.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

from lib import chandra as chandra_lib
from lib.chandra import ChandraContractError, ChandraParseFailed, ChandraSourceAccessError, ensure_parsed, parse_blocks


@asynccontextmanager
async def _fake_download(storage_url):
    """Stand-in for lib.storage.download_to_tempfile — yields the storage_url
    unchanged so tests can assert run_chandra(storage_url, ocr_key)."""
    yield storage_url


# ---------------------------------------------------------------------------
# parse_blocks regression — keep behavior byte-equivalent to the router copy.
# ---------------------------------------------------------------------------

FIXTURE_JSON = {
    "block_type": "Document",
    "children": [
        {
            "block_type": "Page",
            "id": "/page/0/Page/0",
            "bbox": [0, 0, 612, 792],
            "children": [
                {
                    "block_type": "SectionHeader",
                    "id": "/page/0/SectionHeader/0",
                    "bbox": [72, 700, 540, 730],
                    "html": "<h1>Introduction</h1>",
                    "children": [],
                },
            ],
        },
    ],
}


def test_parse_blocks_regression():
    rows = parse_blocks(FIXTURE_JSON)
    assert len(rows) == 1
    page, kind, bbox, payload = rows[0]
    assert page == 0
    assert kind == "section_header"
    assert payload == {"text": "Introduction", "heading_level": 1}
    assert bbox == {
        "x0": 72 / 612,
        "y0": 700 / 792,
        "x1": 540 / 612,
        "y1": 730 / 792,
    }


@pytest.mark.asyncio
async def test_run_chandra_uses_balanced_mode():
    """run_chandra calls ConvertOptions with mode='balanced'."""
    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = None
    mock_client.convert.return_value = {"ok": True}

    with patch("datalab_sdk.AsyncDatalabClient", return_value=mock_client), patch(
        "datalab_sdk.ConvertOptions"
    ) as mock_convert_options:
        await chandra_lib.run_chandra("/tmp/p.pdf", "ck-test")

    mock_convert_options.assert_called_once_with(output_format="json", mode="balanced")


# ---------------------------------------------------------------------------
# ensure_parsed — mock conn fixture.
# ---------------------------------------------------------------------------

PAPER_ID = "11111111-1111-1111-1111-111111111111"


def _make_conn(initial_status: str, storage_url: str | None = "/tmp/p.pdf") -> AsyncMock:
    """Build a stateful AsyncMock conn that simulates papers.chandra_status."""
    conn = AsyncMock()

    state = {"status": initial_status, "storage_url": storage_url}

    async def fetchrow(sql, *args):
        if "SELECT chandra_status, storage_url" in sql:
            return {"chandra_status": state["status"], "storage_url": state["storage_url"]}
        return None

    async def fetchval(sql, *args):
        if "UPDATE papers" in sql and "SET chandra_status = 'running'" in sql:
            # Compare-and-set
            if state["status"] in ("pending", "failed"):
                state["status"] = "running"
                return args[0]  # paper_id
            return None
        if sql.strip().startswith("SELECT chandra_status FROM papers"):
            return state["status"]
        return None

    async def execute(sql, *args):
        if "SET chandra_status = 'done'" in sql:
            state["status"] = "done"
        elif "SET chandra_status = 'failed'" in sql:
            state["status"] = "failed"
        elif "SET chandra_status = 'pending'" in sql:
            state["status"] = "pending"
        return None

    async def executemany(sql, rows):
        return None

    conn.fetchrow.side_effect = fetchrow
    conn.fetchval.side_effect = fetchval
    conn.execute.side_effect = execute
    conn.executemany.side_effect = executemany
    conn._state = state  # for test inspection
    return conn


@pytest.mark.asyncio
async def test_ensure_parsed_noop_when_done():
    """status='done' → return immediately, no Chandra call, no DB write."""
    conn = _make_conn("done")
    with patch("lib.chandra.run_chandra", new_callable=AsyncMock) as mock_run:
        result = await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")
    assert result == "done"
    mock_run.assert_not_called()
    conn.executemany.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_parsed_raises_when_failed():
    """status='failed' → ChandraParseFailed, no Chandra retry."""
    conn = _make_conn("failed")
    with patch("lib.chandra.run_chandra", new_callable=AsyncMock) as mock_run:
        with pytest.raises(ChandraParseFailed):
            await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")
    mock_run.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_parsed_success_path():
    """pending → wins CAS → run_chandra succeeds → segments inserted → status='done'."""
    conn = _make_conn("pending")

    fake_result = type(
        "Result",
        (),
        {"success": True, "json": FIXTURE_JSON, "page_count": 1, "error": None},
    )()

    with patch("lib.chandra.run_chandra", new_callable=AsyncMock, return_value=fake_result) as mock_run, \
         patch("lib.storage.download_to_tempfile", _fake_download):
        result = await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")

    assert result == "done"
    mock_run.assert_called_once_with("/tmp/p.pdf", "ck-test")
    conn.executemany.assert_called_once()
    # status now 'done'
    assert conn._state["status"] == "done"


@pytest.mark.asyncio
async def test_ensure_parsed_chandra_failure_marks_failed():
    """run_chandra raises → status='failed' → ChandraParseFailed propagated."""
    conn = _make_conn("pending")

    with patch(
        "lib.chandra.run_chandra",
        new_callable=AsyncMock,
        side_effect=RuntimeError("network down"),
    ), patch("lib.storage.download_to_tempfile", _fake_download):
        with pytest.raises(ChandraParseFailed):
            await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")

    assert conn._state["status"] == "failed"
    conn.executemany.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_parsed_chandra_returns_unsuccessful_marks_failed():
    """run_chandra returns success=False → status='failed', raised."""
    conn = _make_conn("pending")
    fake_result = type(
        "Result",
        (),
        {"success": False, "json": None, "page_count": 0, "error": "API error"},
    )()

    with patch("lib.chandra.run_chandra", new_callable=AsyncMock, return_value=fake_result), \
         patch("lib.storage.download_to_tempfile", _fake_download):
        with pytest.raises(ChandraParseFailed):
            await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")

    assert conn._state["status"] == "failed"


@pytest.mark.asyncio
async def test_ensure_parsed_concurrent_callers_run_chandra_once():
    """Two concurrent ensure_parsed calls → exactly ONE run_chandra invocation."""
    # Two separate conn objects sharing one state — simulates two pool-acquired
    # connections both seeing the same papers row.
    shared_state = {"status": "pending", "storage_url": "/tmp/p.pdf"}
    cas_lock = asyncio.Lock()

    def make_shared_conn() -> AsyncMock:
        conn = AsyncMock()

        async def fetchrow(sql, *args):
            return {
                "chandra_status": shared_state["status"],
                "storage_url": shared_state["storage_url"],
            }

        async def fetchval(sql, *args):
            if "SET chandra_status = 'running'" in sql:
                async with cas_lock:
                    if shared_state["status"] in ("pending", "failed"):
                        shared_state["status"] = "running"
                        return args[0]
                    return None
            if sql.strip().startswith("SELECT chandra_status FROM papers"):
                return shared_state["status"]
            return None

        async def execute(sql, *args):
            if "SET chandra_status = 'done'" in sql:
                shared_state["status"] = "done"
            elif "SET chandra_status = 'failed'" in sql:
                shared_state["status"] = "failed"
            elif "SET chandra_status = 'pending'" in sql:
                shared_state["status"] = "pending"

        async def executemany(sql, rows):
            return None

        conn.fetchrow.side_effect = fetchrow
        conn.fetchval.side_effect = fetchval
        conn.execute.side_effect = execute
        conn.executemany.side_effect = executemany
        return conn

    fake_result = type(
        "Result",
        (),
        {"success": True, "json": FIXTURE_JSON, "page_count": 1, "error": None},
    )()

    # Slow Chandra so the second caller is forced to poll.
    async def slow_run(file_path, api_key):
        await asyncio.sleep(0.05)
        return fake_result

    # Tighten poll interval so the test isn't slow.
    with patch.object(chandra_lib, "POLL_INTERVAL_SECONDS", 0.01), \
         patch.object(chandra_lib, "POLL_TIMEOUT_SECONDS", 5.0), \
         patch("lib.storage.download_to_tempfile", _fake_download), \
         patch("lib.chandra.run_chandra", new=AsyncMock(side_effect=slow_run)) as mock_run:
        c1 = make_shared_conn()
        c2 = make_shared_conn()
        results = await asyncio.gather(
            ensure_parsed(PAPER_ID, c1, ocr_key="ck-test"),
            ensure_parsed(PAPER_ID, c2, ocr_key="ck-test"),
        )

    assert results == ["done", "done"]
    assert mock_run.call_count == 1
    assert shared_state["status"] == "done"


@pytest.mark.asyncio
async def test_ensure_parsed_missing_storage_url_marks_failed():
    """A paper with NULL storage_url and no canonical object is a contract error."""
    conn = _make_conn("pending", storage_url=None)
    with patch("lib.storage.object_exists", new_callable=AsyncMock, return_value=False):
        with pytest.raises(ChandraContractError):
            await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")
    assert conn._state["status"] == "failed"


@pytest.mark.asyncio
async def test_ensure_parsed_missing_storage_url_uses_canonical_fallback_when_present():
    """If storage_url is NULL but canonical source exists, parse should proceed."""
    conn = _make_conn("pending", storage_url=None)
    fake_result = type(
        "Result",
        (),
        {"success": True, "json": FIXTURE_JSON, "page_count": 1, "error": None},
    )()

    with patch("lib.storage.object_exists", new_callable=AsyncMock, return_value=True), \
         patch("lib.storage.download_to_tempfile", _fake_download), \
         patch("lib.chandra.run_chandra", new_callable=AsyncMock, return_value=fake_result) as mock_run:
        result = await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")

    assert result == "done"
    mock_run.assert_called_once_with(f"{PAPER_ID}/source.pdf", "ck-test")
    assert conn._state["status"] == "done"


@pytest.mark.asyncio
async def test_ensure_parsed_missing_storage_url_exists_check_error_is_transient():
    """Canonical existence check errors are transient source-access failures."""
    conn = _make_conn("pending", storage_url=None)
    with patch(
        "lib.storage.object_exists",
        new_callable=AsyncMock,
        side_effect=RuntimeError("s3 unavailable"),
    ):
        with pytest.raises(ChandraSourceAccessError):
            await ensure_parsed(PAPER_ID, conn, ocr_key="ck-test")
    assert conn._state["status"] == "pending"


@pytest.mark.asyncio
async def test_ensure_parsed_paper_not_found():
    """Unknown paper_id → ChandraParseFailed (no UPDATE attempted)."""
    conn = AsyncMock()
    conn.fetchrow.return_value = None
    with pytest.raises(ChandraParseFailed):
        await ensure_parsed("00000000-0000-0000-0000-000000000000", conn, ocr_key="x")
