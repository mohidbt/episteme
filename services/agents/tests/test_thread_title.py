"""Tests for lib/thread_title — title generation + DB persistence."""
from unittest.mock import AsyncMock

import pytest

from lib import thread_title as tt


@pytest.mark.asyncio
async def test_generate_title_happy_path(monkeypatch):
    async def fake_call(api_key, system, user_content):
        return "Summarize attention paper"

    monkeypatch.setattr(tt, "call_model", fake_call)
    out = await tt.generate_title("k", "tell me about Vaswani 2017")
    assert out == "Summarize attention paper"


@pytest.mark.asyncio
async def test_generate_title_strips_trailing_period(monkeypatch):
    async def fake_call(api_key, system, user_content):
        return "Triage arxiv stack."

    monkeypatch.setattr(tt, "call_model", fake_call)
    out = await tt.generate_title("k", "help me triage arxiv")
    assert out == "Triage arxiv stack"


@pytest.mark.asyncio
async def test_generate_title_strips_surrounding_quotes(monkeypatch):
    async def fake_call(api_key, system, user_content):
        return '"Title here"'

    monkeypatch.setattr(tt, "call_model", fake_call)
    out = await tt.generate_title("k", "hi")
    assert out == "Title here"


@pytest.mark.asyncio
async def test_generate_title_caps_at_60_chars(monkeypatch):
    long = "x" * 200

    async def fake_call(api_key, system, user_content):
        return long

    monkeypatch.setattr(tt, "call_model", fake_call)
    out = await tt.generate_title("k", "anything")
    assert len(out) <= 60
    assert out == "x" * 60


@pytest.mark.asyncio
async def test_generate_title_returns_empty_on_exception(monkeypatch):
    async def boom(api_key, system, user_content):
        raise RuntimeError("network down")

    monkeypatch.setattr(tt, "call_model", boom)
    out = await tt.generate_title("k", "anything")
    assert out == ""


@pytest.mark.asyncio
async def test_generate_title_empty_input_skips_call(monkeypatch):
    called = False

    async def fake_call(api_key, system, user_content):
        nonlocal called
        called = True
        return "Should not happen"

    monkeypatch.setattr(tt, "call_model", fake_call)
    out = await tt.generate_title("k", "   \n  ")
    assert out == ""
    assert called is False


@pytest.mark.asyncio
async def test_maybe_set_thread_title_updates_when_no_title(monkeypatch):
    async def fake_call(api_key, system, user_content):
        return "Cool new thread"

    monkeypatch.setattr(tt, "call_model", fake_call)

    conn = AsyncMock()
    conn.fetchrow.return_value = {"title": None}

    out = await tt.maybe_set_thread_title(
        conn, user_id="u1", thread_id="t1",
        first_user_message="hello world", api_key="k",
    )
    assert out == "Cool new thread"
    conn.execute.assert_awaited_once()
    sql = conn.execute.await_args.args[0]
    assert "UPDATE agent_threads" in sql
    assert "title IS NULL" in sql
    assert conn.execute.await_args.args[1:] == ("u1", "t1", "Cool new thread")


@pytest.mark.asyncio
async def test_maybe_set_thread_title_noop_when_title_set(monkeypatch):
    async def fake_call(api_key, system, user_content):
        return "Should not be used"

    monkeypatch.setattr(tt, "call_model", fake_call)

    conn = AsyncMock()
    conn.fetchrow.return_value = {"title": "Existing"}

    out = await tt.maybe_set_thread_title(
        conn, user_id="u1", thread_id="t1",
        first_user_message="hello", api_key="k",
    )
    assert out is None
    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_maybe_set_thread_title_row_missing(monkeypatch):
    async def fake_call(api_key, system, user_content):
        return "X"

    monkeypatch.setattr(tt, "call_model", fake_call)

    conn = AsyncMock()
    conn.fetchrow.return_value = None

    out = await tt.maybe_set_thread_title(
        conn, user_id="u1", thread_id="t1",
        first_user_message="hi", api_key="k",
    )
    assert out is None
    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_maybe_set_thread_title_empty_message(monkeypatch):
    called = False

    async def fake_call(api_key, system, user_content):
        nonlocal called
        called = True
        return "X"

    monkeypatch.setattr(tt, "call_model", fake_call)

    conn = AsyncMock()
    out = await tt.maybe_set_thread_title(
        conn, user_id="u1", thread_id="t1",
        first_user_message="   ", api_key="k",
    )
    assert out is None
    conn.fetchrow.assert_not_awaited()
    conn.execute.assert_not_awaited()
    assert called is False


@pytest.mark.asyncio
async def test_maybe_set_thread_title_skips_update_on_empty_generation(monkeypatch):
    async def fake_call(api_key, system, user_content):
        raise RuntimeError("boom")

    monkeypatch.setattr(tt, "call_model", fake_call)

    conn = AsyncMock()
    conn.fetchrow.return_value = {"title": None}

    out = await tt.maybe_set_thread_title(
        conn, user_id="u1", thread_id="t1",
        first_user_message="something", api_key="k",
    )
    assert out is None
    conn.execute.assert_not_awaited()
