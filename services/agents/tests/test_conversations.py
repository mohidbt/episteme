import os
os.environ.setdefault("INHALE_INTERNAL_SECRET", "test-secret-abc")

import json
from unittest.mock import AsyncMock
from datetime import datetime, timezone
import pytest

from lib.conversations import upsert_conversation, insert_message, bump_updated_at


@pytest.mark.asyncio
async def test_upsert_creates_new():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": 42}
    result = await upsert_conversation(conn, user_id="u1", document_id=1, conversation_id=None, title="Hello world")
    assert result == 42
    conn.fetchrow.assert_called_once()
    args = conn.fetchrow.call_args
    assert "INSERT INTO agent_conversations" in args[0][0]


@pytest.mark.asyncio
async def test_upsert_returns_existing():
    conn = AsyncMock()
    result = await upsert_conversation(conn, user_id="u1", document_id=1, conversation_id=99, title="Ignored")
    assert result == 99
    conn.fetchrow.assert_not_called()


@pytest.mark.asyncio
async def test_upsert_truncates_title():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": 1}
    long_title = "x" * 200
    await upsert_conversation(conn, user_id="u1", document_id=1, conversation_id=None, title=long_title)
    inserted_title = conn.fetchrow.call_args[0][3]
    assert len(inserted_title) == 80


@pytest.mark.asyncio
async def test_insert_message_with_viewport():
    conn = AsyncMock()
    viewport = {"page": 3, "scrollPct": 0.5}
    await insert_message(conn, conversation_id=1, role="user", content="hi", viewport=viewport)
    conn.execute.assert_called_once()
    args = conn.execute.call_args[0]
    assert json.loads(args[4]) == viewport


@pytest.mark.asyncio
async def test_insert_message_without_viewport():
    conn = AsyncMock()
    await insert_message(conn, conversation_id=1, role="assistant", content="hello")
    args = conn.execute.call_args[0]
    assert args[4] is None


@pytest.mark.asyncio
async def test_bump_updated_at():
    conn = AsyncMock()
    await bump_updated_at(conn, 42)
    conn.execute.assert_called_once()
    args = conn.execute.call_args[0]
    assert "UPDATE agent_conversations" in args[0]
    assert args[2] == 42
    assert isinstance(args[1], datetime)
