import json as _json
from datetime import datetime, timezone


async def upsert_conversation(conn, *, user_id, document_id, conversation_id, title):
    if conversation_id is not None:
        return conversation_id
    row = await conn.fetchrow(
        "INSERT INTO agent_conversations (user_id, document_id, title) VALUES ($1, $2, $3) RETURNING id",
        user_id, document_id, title[:80],
    )
    return row["id"]


async def insert_message(conn, *, conversation_id, role, content, viewport=None):
    viewport_json = _json.dumps(viewport) if viewport else None
    await conn.execute(
        "INSERT INTO agent_messages (conversation_id, role, content, viewport_context) VALUES ($1, $2, $3, $4::jsonb)",
        conversation_id, role, content, viewport_json,
    )


async def bump_updated_at(conn, conversation_id):
    await conn.execute(
        "UPDATE agent_conversations SET updated_at = $1 WHERE id = $2",
        datetime.now(timezone.utc), conversation_id,
    )
