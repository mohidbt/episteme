from typing import Annotated
from fastapi import APIRouter, HTTPException
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
    paperId: str
    chunks: Annotated[list[Chunk], Field(min_length=1, max_length=512)]


class EmbedChunksResponse(BaseModel):
    inserted: int


@router.post("/embed-chunks")
async def embed_chunks(
    body: EmbedChunksBody,
    auth: InternalAuthDep,
    conn: ConnDep,
) -> EmbedChunksResponse:
    owned = await conn.fetchval(
        "SELECT 1 FROM papers WHERE id = $1 AND user_id = $2",
        body.paperId,
        auth["user_id"],
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Paper not found")
    vecs = await embed_texts(auth["llm_key"], [c.content for c in body.chunks])
    if len(vecs) != len(body.chunks):
        raise ValueError("embedding count mismatch")

    rows = [
        (body.paperId, c.chunkIndex, c.content, c.pageStart, c.pageEnd, c.tokenCount, v)
        for c, v in zip(body.chunks, vecs)
    ]
    # GSD-96 R1 fix: INSERT + UPDATE wrapped in a single transaction so the
    # signal stamp is atomic with the chunk write (crash between leaves both
    # unset, not orphaned chunks w/ a missing signal). ON CONFLICT DO NOTHING
    # gives idempotency on retry — paired with UNIQUE (paper_id, chunk_index)
    # added in 0053_document_chunks_unique_paper_index.sql.
    async with conn.transaction():
        await conn.executemany(
            """
            INSERT INTO document_chunks
              (paper_id, chunk_index, content, page_start, page_end, token_count, embedding)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (paper_id, chunk_index) DO NOTHING
            """,
            rows,
        )
        # Stamp chunks_ready_at once chunks + embeddings persist (both land
        # in the same INSERT above, so this single UPDATE is the canonical
        # "paper is RAG-ready" signal). Consumed by GET /api/papers/[id]/ingest-status.
        await conn.execute(
            "UPDATE papers SET chunks_ready_at = now() WHERE id = $1 AND user_id = $2",
            body.paperId,
            auth["user_id"],
        )
    return EmbedChunksResponse(inserted=len(rows))
