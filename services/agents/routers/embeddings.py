from typing import Annotated
from fastapi import APIRouter
from pydantic import BaseModel, Field
from deps.auth import InternalAuthDep
from deps.db import ConnDep
from lib.openrouter_client import embed_texts

router = APIRouter(prefix="/agents", tags=["embeddings"])


class Chunk(BaseModel):
    chunkIndex: int
    content: str
    pageStart: int
    pageEnd: int
    tokenCount: int


class EmbedChunksBody(BaseModel):
    documentId: int
    chunks: Annotated[list[Chunk], Field(min_length=1, max_length=512)]


class EmbedChunksResponse(BaseModel):
    inserted: int


@router.post("/embed-chunks")
async def embed_chunks(
    body: EmbedChunksBody,
    auth: InternalAuthDep,
    conn: ConnDep,
) -> EmbedChunksResponse:
    vecs = await embed_texts(auth["llm_key"], [c.content for c in body.chunks])
    if len(vecs) != len(body.chunks):
        raise ValueError("embedding count mismatch")

    rows = [
        (body.documentId, c.chunkIndex, c.content, c.pageStart, c.pageEnd, c.tokenCount, v)
        for c, v in zip(body.chunks, vecs)
    ]
    await conn.executemany(
        """
        INSERT INTO document_chunks
          (document_id, chunk_index, content, page_start, page_end, token_count, embedding)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        """,
        rows,
    )
    return EmbedChunksResponse(inserted=len(rows))
