"""Tests for SafeStore — defensive wrapper around langgraph BaseStore.

These tests use MagicMock-style fakes (not real langgraph stores) because
we only care that SafeStore catches the decode error and falls through to
a safe default; the real storage semantics are exercised elsewhere.
"""
import logging
from unittest.mock import AsyncMock, MagicMock

import orjson
import pytest

from lib.safe_store import SafeStore


def _fake_inner() -> MagicMock:
    """A MagicMock that satisfies the abstract BaseStore checks SafeStore needs."""
    m = MagicMock()
    m.supports_ttl = False
    m.ttl_config = None
    return m


def test_aget_returns_inner_value_when_ok():
    inner = _fake_inner()
    sentinel = object()
    inner.aget = AsyncMock(return_value=sentinel)
    safe = SafeStore(inner)

    import asyncio
    result = asyncio.new_event_loop().run_until_complete(
        safe.aget(("ns",), "k")
    )
    assert result is sentinel


def test_aget_returns_none_on_orjson_decode_error(caplog):
    inner = _fake_inner()
    inner.aget = AsyncMock(
        side_effect=orjson.JSONDecodeError("unexpected character", "", 0)
    )
    safe = SafeStore(inner)

    import asyncio
    with caplog.at_level(logging.WARNING, logger="lib.safe_store"):
        result = asyncio.new_event_loop().run_until_complete(
            safe.aget(("memories:user1",), "bad-key")
        )

    assert result is None
    assert any(
        "skipping unparseable row" in rec.message
        and "memories:user1" in rec.message
        and "bad-key" in rec.message
        for rec in caplog.records
    )


def test_get_returns_none_on_decode_error(caplog):
    inner = _fake_inner()
    inner.get = MagicMock(
        side_effect=orjson.JSONDecodeError("unexpected character", "", 0)
    )
    safe = SafeStore(inner)

    with caplog.at_level(logging.WARNING, logger="lib.safe_store"):
        result = safe.get(("memories:u",), "x")

    assert result is None
    assert any("skipping unparseable row" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_asearch_returns_empty_on_decode_error(caplog):
    inner = _fake_inner()
    inner.asearch = AsyncMock(
        side_effect=orjson.JSONDecodeError("unexpected character", "", 0)
    )
    safe = SafeStore(inner)

    with caplog.at_level(logging.WARNING, logger="lib.safe_store"):
        result = await safe.asearch(("memories:u",), limit=10, offset=0)

    assert result == []
    assert any(
        "dropping batch" in r.message and "memories:u" in r.message
        for r in caplog.records
    )


@pytest.mark.asyncio
async def test_asearch_returns_inner_when_ok():
    inner = _fake_inner()
    items = [MagicMock(name="item1"), MagicMock(name="item2")]
    inner.asearch = AsyncMock(return_value=items)
    safe = SafeStore(inner)

    result = await safe.asearch(("memories:u",))
    assert result is items


def test_search_returns_empty_on_decode_error(caplog):
    inner = _fake_inner()
    inner.search = MagicMock(
        side_effect=orjson.JSONDecodeError("unexpected character", "", 0)
    )
    safe = SafeStore(inner)

    with caplog.at_level(logging.WARNING, logger="lib.safe_store"):
        result = safe.search(("memories:u",))

    assert result == []


@pytest.mark.asyncio
async def test_aput_passthrough():
    inner = _fake_inner()
    inner.aput = AsyncMock(return_value=None)
    safe = SafeStore(inner)

    await safe.aput(("ns",), "k", {"content": "hi", "encoding": "utf-8"})
    inner.aput.assert_awaited_once()


def test_put_passthrough():
    inner = _fake_inner()
    inner.put = MagicMock(return_value=None)
    safe = SafeStore(inner)

    safe.put(("ns",), "k", {"content": "hi", "encoding": "utf-8"})
    inner.put.assert_called_once()


def test_unknown_attribute_proxies_to_inner():
    inner = _fake_inner()
    inner.setup = MagicMock()
    safe = SafeStore(inner)

    safe.setup()
    inner.setup.assert_called_once()


def test_aget_does_not_swallow_unrelated_exceptions():
    inner = _fake_inner()
    inner.aget = AsyncMock(side_effect=RuntimeError("connection lost"))
    safe = SafeStore(inner)

    import asyncio
    with pytest.raises(RuntimeError, match="connection lost"):
        asyncio.new_event_loop().run_until_complete(safe.aget(("ns",), "k"))
