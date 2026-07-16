from typing import Annotated
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.openrouter_client import embed_texts

router = APIRouter(prefix="/agents/km", tags=["km-embeddings"])


class KmChunk(BaseModel):
    chunkIdx: int
    content: str


class EmbedNoteChunksBody(BaseModel):
    noteId: str
    chunks: Annotated[list[KmChunk], Field(min_length=1, max_length=512)]


class EmbedNoteChunksResponse(BaseModel):
    inserted: int


@router.post("/embed-note-chunks")
async def embed_note_chunks(
    body: EmbedNoteChunksBody,
    auth: InternalAuthDep,
    conn: ConnDep,
) -> EmbedNoteChunksResponse:
    owned = await conn.fetchval(
        "SELECT 1 FROM notes WHERE id = $1::uuid AND user_id = $2",
        body.noteId,
        auth["user_id"],
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Note not found")
    vecs = await embed_texts(auth["llm_key"], [c.content for c in body.chunks])
    if len(vecs) != len(body.chunks):
        raise ValueError("embedding count mismatch")

    rows = [(body.noteId, c.chunkIdx, c.content, v) for c, v in zip(body.chunks, vecs)]
    async with conn.transaction():
        await conn.execute(
            "DELETE FROM note_chunks WHERE note_id = $1::uuid", body.noteId
        )
        await conn.executemany(
            """
            INSERT INTO note_chunks (note_id, chunk_idx, content, embedding, metadata)
            VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
            """,
            [(r[0], r[1], r[2], r[3], "{}") for r in rows],
        )
    return EmbedNoteChunksResponse(inserted=len(rows))
