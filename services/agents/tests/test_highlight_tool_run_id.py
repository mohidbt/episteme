"""B5 — highlight() tool must use a stable run_id per agent run.

Prior behavior: each `highlight()` invocation minted a fresh `uuid4`, so N
tool calls in one chat turn produced N separate runs in the reader sidebar.
Fix: read run_id from RunnableConfig.configurable.run_id; fall back to UUID
only when no context is provided.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest


class _FakePool:
    def __init__(self, rows):
        self._rows = rows

    def acquire(self):
        rows = self._rows

        class _Ctx:
            async def __aenter__(self_inner):
                conn = MagicMock()

                async def fetch(*_args, **_kwargs):
                    return rows

                async def fetchrow(*_args, **_kwargs):
                    return {
                        "id": "p",
                        "title": "t",
                        "storage_url": "s",
                        "processing_status": "done",
                    }

                conn.fetch = fetch
                conn.fetchrow = fetchrow
                return conn

            async def __aexit__(self_inner, *_):
                return False

        return _Ctx()


def _segment_row(page: int, order_index: int):
    row = {
        "page": page,
        "bbox": json.dumps({"x0": 1.0, "y0": 2.0, "x1": 3.0, "y1": 4.0}),
        "order_index": order_index,
    }

    class _R(dict):
        def __getitem__(self, k):
            return super().__getitem__(k)

    return _R(row)


@pytest.mark.asyncio
async def test_highlight_uses_stable_run_id_from_config():
    from tools.pdfs import highlight
    from deps import db as db_module

    paper_id = "11111111-1111-1111-1111-111111111111"
    block_ids = [f"{paper_id}:p1:0"]
    rows = [_segment_row(0, 0)]

    captured_bodies: list[dict] = []

    async def fake_post(_path, body, *, user_id):
        captured_bodies.append(body)
        return {"id": 42}

    cfg = {
        "configurable": {
            "user_id": "user_test",
            "thread_id": "thread_abc",
            "run_id": "fixed-run-id-1234",
        }
    }

    with patch.object(db_module, "_pool", _FakePool(rows)), patch(
        "tools.pdfs.km_post", new=fake_post
    ):
        await highlight.ainvoke(
            {"pdf_id": paper_id, "block_ids": block_ids}, config=cfg
        )
        await highlight.ainvoke(
            {"pdf_id": paper_id, "block_ids": block_ids}, config=cfg
        )

    assert len(captured_bodies) == 2
    rid1 = captured_bodies[0]["runId"]
    rid2 = captured_bodies[1]["runId"]
    assert rid1 == rid2 == "fixed-run-id-1234", (
        f"expected both calls to share run_id 'fixed-run-id-1234', got {rid1!r} and {rid2!r}"
    )


@pytest.mark.asyncio
async def test_highlight_falls_back_to_uuid_when_no_run_id_in_config():
    from tools.pdfs import highlight
    from deps import db as db_module

    paper_id = "22222222-2222-2222-2222-222222222222"
    block_ids = [f"{paper_id}:p1:0"]
    rows = [_segment_row(0, 0)]

    captured_bodies: list[dict] = []

    async def fake_post(_path, body, *, user_id):
        captured_bodies.append(body)
        return {"id": 7}

    cfg = {"configurable": {"user_id": "user_test"}}

    with patch.object(db_module, "_pool", _FakePool(rows)), patch(
        "tools.pdfs.km_post", new=fake_post
    ):
        await highlight.ainvoke(
            {"pdf_id": paper_id, "block_ids": block_ids}, config=cfg
        )

    assert "runId" in captured_bodies[0]
    rid = captured_bodies[0]["runId"]
    assert isinstance(rid, str) and len(rid) >= 8
