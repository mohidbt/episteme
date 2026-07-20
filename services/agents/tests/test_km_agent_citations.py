"""RED tests for Round 2 inline citation rebuild (B1/B2/B3).

Asserts on the pure function ``_extract_rag_citations_from_tool_result`` in
``routers.km_agent``: dedup by ``(paper_id, page, order_index)``, similarity
floor 0.35, hard cap 12, and a non-empty ``title`` per emitted citation.
"""
from __future__ import annotations

import hashlib
import hmac
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


def test_state_surfaces_citations_from_metadata_table() -> None:
    """Citation pills on thread reload come from agent_message_metadata,
    not from AIMessage.additional_kwargs. `/state/{thread_id}` must merge
    rows where (thread_id, user_id, kind='citations') match the caller.
    """
    from langchain_core.messages import AIMessage, HumanMessage  # noqa: PLC0415

    path = "/agents/km/state/thread-meta-1"
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
    ai = AIMessage(content="Per the paper [1].", id="a-cite")
    msgs = [HumanMessage(content="why?", id="u-1"), ai]
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": msgs}}
    mock_tuple.config = {"configurable": {"user_id": "user_1"}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    async def fake_fetch(*, thread_id: str, user_id: str):
        assert thread_id == "thread-meta-1"
        assert user_id == "user_1"
        return {("a-cite", "citations"): citations}

    with (
        patch("routers.km_agent.get_saver", return_value=mock_saver),
        patch("routers.km_agent.fetch_thread_metadata", side_effect=fake_fetch),
    ):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 200
    data = r.json()
    ai_payload = next(m for m in data["messages"] if m["id"] == "a-cite")
    assert ai_payload.get("citations") == citations, (
        f"expected metadata-merged citations on AI message, got: {ai_payload}"
    )


def test_state_strips_lc_run_prefix_when_merging_metadata() -> None:
    """LangChain prefixes checkpoint AIMessage.id with ``lc_run--`` while the
    SSE event ``run_id`` (which we persist off) is the raw UUID. /state must
    try both the literal id and the prefix-stripped variant so persisted
    citations rehydrate.
    """
    from langchain_core.messages import AIMessage, HumanMessage  # noqa: PLC0415

    path = "/agents/km/state/thread-prefix-1"
    citations = [
        {
            "chunk_id": "paper-1:p4:7",
            "paper_id": "paper-1",
            "title": "X - Page 4",
            "score": 0.9,
            "snippet": "s",
            "page": 4,
            "bbox": {"x0": 0.0, "y0": 0.0, "x1": 1.0, "y1": 1.0},
        }
    ]
    raw_uuid = "019e557a-afa8-7aa1-88b5-1adcf4ae573d"
    ai = AIMessage(content="x [1].", id=f"lc_run--{raw_uuid}")
    msgs = [HumanMessage(content="q", id="u-1"), ai]
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": msgs}}
    mock_tuple.config = {"configurable": {"user_id": "user_1"}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    async def fake_fetch(*, thread_id: str, user_id: str):
        # Persisted under the raw SSE run_id, not the lc_run-- prefixed
        # checkpoint id.
        return {(raw_uuid, "citations"): citations}

    with (
        patch("routers.km_agent.get_saver", return_value=mock_saver),
        patch("routers.km_agent.fetch_thread_metadata", side_effect=fake_fetch),
    ):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 200
    data = r.json()
    ai_payload = next(m for m in data["messages"] if m["id"] == f"lc_run--{raw_uuid}")
    assert ai_payload.get("citations") == citations, (
        f"expected citations after lc_run-- prefix strip, got: {ai_payload}"
    )


def test_state_rejects_caller_when_thread_owner_mismatches() -> None:
    """GSD-222: /state/{thread_id} 403s when the checkpoint's restored
    ``configurable.checkpoint_ns`` belongs to a DIFFERENT tenant.

    (Rewritten from the pre-GSD-222 ``user_id`` contract: AsyncPostgresSaver
    drops ``user_id`` on a cold read but preserves ``checkpoint_ns``, so the
    owner check is enforced on the namespace instead.)
    """
    from langchain_core.messages import AIMessage  # noqa: PLC0415
    from routers.km_agent import _checkpoint_namespace  # noqa: PLC0415

    path = "/agents/km/state/thread-owner-mismatch"
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": [AIMessage(content="x", id="a-1")]}}
    mock_tuple.config = {"configurable": {"thread_id": "thread-owner-mismatch", "checkpoint_ns": _checkpoint_namespace("user_999")}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 403, r.text


def test_state_allows_caller_when_thread_owner_matches() -> None:
    """GSD-222: caller's own tenant ``checkpoint_ns`` on the checkpoint → 200."""
    from langchain_core.messages import AIMessage  # noqa: PLC0415
    from routers.km_agent import _checkpoint_namespace  # noqa: PLC0415

    path = "/agents/km/state/thread-owner-match"
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": [AIMessage(content="x", id="a-1")]}}
    mock_tuple.config = {"configurable": {"thread_id": "thread-owner-match", "checkpoint_ns": _checkpoint_namespace("user_1")}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 200, r.text


def test_state_allows_caller_when_checkpoint_ns_absent() -> None:
    """When the restored config carries NO ``checkpoint_ns`` (defensive), fall
    back to trusting the namespace-scoped ``aget_tuple`` query rather than
    failing closed — the query already filtered to the caller's tenant ns."""
    from langchain_core.messages import AIMessage  # noqa: PLC0415

    path = "/agents/km/state/thread-no-ns"
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": [AIMessage(content="x", id="a-1")]}}
    mock_tuple.config = {"configurable": {"thread_id": "thread-no-ns"}}  # no checkpoint_ns
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    with patch("routers.km_agent.get_saver", return_value=mock_saver):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 200, r.text


def test_persist_metadata_called_during_invoke_source() -> None:
    """Citations persist inline during the SSE stream — both /invoke and
    /resume must call ``persist_message_metadata`` when emitting sources.
    Source-level guard so an integration test isn't required.
    """
    import inspect  # noqa: PLC0415
    import routers.km_agent as mod  # noqa: PLC0415

    for fn_name in ("invoke", "resume"):
        src = inspect.getsource(getattr(mod, fn_name))
        assert "persist_message_metadata" in src, (
            f"{fn_name} gen() must call persist_message_metadata"
        )
        assert "CITATIONS_KIND" in src, (
            f"{fn_name} gen() must pass kind=CITATIONS_KIND"
        )


def test_state_omits_citations_when_metadata_empty() -> None:
    """Sanity: AI messages without metadata rows do not gain a citations key."""
    from langchain_core.messages import AIMessage  # noqa: PLC0415

    path = "/agents/km/state/thread-bg1b"
    msgs = [AIMessage(content="hi", id="a-x")]
    mock_tuple = MagicMock()
    mock_tuple.checkpoint = {"channel_values": {"todos": [], "messages": msgs}}
    mock_tuple.config = {"configurable": {"user_id": "user_1"}}
    mock_saver = MagicMock()
    mock_saver.aget_tuple = AsyncMock(return_value=mock_tuple)

    async def empty_fetch(*, thread_id: str, user_id: str):
        return {}

    with (
        patch("routers.km_agent.get_saver", return_value=mock_saver),
        patch("routers.km_agent.fetch_thread_metadata", side_effect=empty_fetch),
    ):
        r = client.get(path, headers=_signed_headers("GET", path, b""))

    assert r.status_code == 200
    data = r.json()
    a = next(m for m in data["messages"] if m["id"] == "a-x")
    assert "citations" not in a, f"unexpected citations key on bare message: {a}"
