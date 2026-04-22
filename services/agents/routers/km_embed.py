from typing import Annotated
from fastapi import APIRouter
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


# Note ownership is enforced by the Next.js proxy layer, not here.
@router.post("/embed-note-chunks")
async def embed_note_chunks(
    body: EmbedNoteChunksBody,
    auth: InternalAuthDep,
    conn: ConnDep,
) -> EmbedNoteChunksResponse:
    vecs = await embed_texts(auth["llm_key"], [c.content for c in body.chunks])
    if len(vecs) != len(body.chunks):
        raise ValueError("embedding count mismatch")

    await conn.execute(
        "DELETE FROM note_embeddings WHERE note_id = $1::uuid",
        body.noteId,
    )
    rows = [(body.noteId, c.chunkIdx, c.content, v) for c, v in zip(body.chunks, vecs)]
    await conn.executemany(
        """
        INSERT INTO note_embeddings (note_id, chunk_idx, content, embedding)
        VALUES ($1::uuid, $2, $3, $4)
        """,
        rows,
    )
    return EmbedNoteChunksResponse(inserted=len(rows))
