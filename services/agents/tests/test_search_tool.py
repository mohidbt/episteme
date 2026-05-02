from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.search import search_library

CFG = {"configurable": {"user_id": "u1"}}


@asynccontextmanager
async def _fake_acquire(conn):
    yield conn


def _mock_pool(conn):
    pool = MagicMock()
    pool.acquire = lambda: _fake_acquire(conn)
    return pool


@pytest.mark.asyncio
async def test_search_tool_schema_and_k_cap():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"chunk_id": "n1c1", "source_id": "n1", "source_kind": "note", "page": None, "snippet": "note hit"}],
        [{"chunk_id": "p1c1", "source_id": "p1", "source_kind": "paper", "page": 3, "snippet": "paper hit"}],
    ]
    with patch("tools.search._get_pool", return_value=_mock_pool(conn)):
        out = await search_library.ainvoke({"query": "hit", "k": 99}, config=CFG)
    assert out["k"] == 8
    assert len(out["results"]) == 2
    assert out["results"][1]["page"] == 3


@pytest.mark.asyncio
async def test_search_tool_user_scoped_query():
    conn = AsyncMock()
    conn.fetch.side_effect = [[], []]
    with patch("tools.search._get_pool", return_value=_mock_pool(conn)):
        await search_library.ainvoke({"query": "abc"}, config=CFG)
    args1 = conn.fetch.await_args_list[0].args
    assert args1[1] == "u1"


def test_search_library_registered():
    from tools import ALL_TOOLS  # noqa: PLC0415

    assert "search_library" in {t.name for t in ALL_TOOLS}
