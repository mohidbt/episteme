"""RED tests for Round 2 inline citation rebuild (B1/B2/B3).

Asserts on the pure function ``_extract_rag_citations_from_tool_result`` in
``routers.km_agent``: dedup by ``(paper_id, page, order_index)``, similarity
floor 0.35, hard cap 12, and a non-empty ``title`` per emitted citation.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

SECRET = "test-secret-abc"
os.environ["INHALE_INTERNAL_SECRET"] = SECRET

from app import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from routers.km_agent import _extract_rag_citations_from_tool_result  # noqa: E402

client = TestClient(app)


def _signed_headers(method: str, path: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(
        SECRET.encode(),
        ts.encode() + method.encode() + path.encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Inhale-User-Id": "user_1",
        "X-Inhale-LLM-Key": "sk-test",
        "X-Inhale-Ts": ts,
        "X-Inhale-Sig": sig,
        "Content-Type": "application/json",
    }


PAPER_ID = "00000000-0000-0000-0000-000000000001"
PAPER_TITLE = "Attention Is All You Need"


def _block(page: int, order_index: int, score: float) -> dict:
    return {
        "block_id": f"{PAPER_ID}:p{page}:{order_index}",
        "kind": "paragraph",
        "page": page,
        "text": f"Block {order_index} text on page {page}",
        "bbox": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0},
        "score": score,
    }


def _build_mock_event_pair() -> tuple[dict, tuple[str, dict]]:
    # 30 blocks across 4 pages of one paper, all above floor.
    blocks: list[dict] = []
    pages = [1, 2, 3, 4]
    # 7+8+8+7 = 30 blocks
    counts = [7, 8, 8, 7]
    order = 0
    for page, n in zip(pages, counts):
        for _ in range(n):
            blocks.append(_block(page=page, order_index=order, score=0.85))
            order += 1
    # One duplicate of the very first block — same (paper_id, page, order_index).
    blocks.append(_block(page=1, order_index=0, score=0.9))
    # One low-score block under the floor.
    blocks.append(_block(page=5, order_index=999, score=0.2))

    ev = {"name": "read_paper"}
    mapped = (
        "tool_result",
        {
            "output": {
                "paper_id": PAPER_ID,
                "paper_title": PAPER_TITLE,
                "blocks": blocks,
                "truncated": False,
                "token_count": 1234,
            }
        },
    )
    return ev, mapped


def test_dedup_floor_cap_and_titles() -> None:
    ev, mapped = _build_mock_event_pair()
    citations = _extract_rag_citations_from_tool_result(ev, mapped)

    # Hard cap of 12.
    assert len(citations) <= 12, f"expected ≤ 12 citations, got {len(citations)}"

    # Dedup by (paper_id, page, order_index).
    keys = [
        (c.get("paper_id"), c.get("page"), c["chunk_id"].rsplit(":", 1)[-1])
        for c in citations
    ]
    assert len(set(keys)) == len(keys), f"duplicate (paper, page, order_index): {keys}"

    # Floor of 0.35 — low-score block must be absent.
    for c in citations:
        assert c.get("score") is not None, "missing score"
        assert c["score"] >= 0.35, f"citation below floor: {c}"

    # Title present and matches expected format.
    for c in citations:
        assert c.get("title"), f"missing title on citation {c}"
        page = c.get("page")
        assert c["title"] == f"{PAPER_TITLE} - Page {page}", c["title"]


def test_state_surfaces_persisted_citations_from_additional_kwargs() -> None:
    """BG1: when an AIMessage in the checkpoint carries citations in
    ``additional_kwargs``, ``/state/{thread_id}`` must include them on the
    serialized message payload so reload rehydrates the citation pills.
    """
    from langchain_core.messages import AIMessage, HumanMessage  # noqa: PLC0415

    path = "/agents/km/state/thread-bg1"
    citations = [
        {
            "chunk_id": "paper-1:p4:7",
            "paper_id": "paper-1",
            "title": "Attention Is All You Need - Page 4",
            "score": 0.91,
            "snippet": "Block 7 text",
            "page": 4,
            "bbox": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0},
        }
    ]
    ai = AIMessage(
        content="Per the paper [1].",
        id="a-cite",
        additional_kwargs={"citations": citations},
    )
    msgs = [HumanMessage(content="why?", id="u-1"), ai]
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": msgs}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 200
    data = r.json()
    ai_payload = next(m for m in data["messages"] if m["id"] == "a-cite")
    assert ai_payload.get("citations") == citations, (
        f"expected citations array on persisted AI message, got: {ai_payload}"
    )


def test_state_omits_citations_when_additional_kwargs_empty() -> None:
    """Sanity: AI messages without citations do not gain an empty array."""
    from langchain_core.messages import AIMessage  # noqa: PLC0415

    path = "/agents/km/state/thread-bg1b"
    msgs = [AIMessage(content="hi", id="a-x")]
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": msgs}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 200
    data = r.json()
    a = next(m for m in data["messages"] if m["id"] == "a-x")
    assert "citations" not in a, f"unexpected citations key on bare message: {a}"
