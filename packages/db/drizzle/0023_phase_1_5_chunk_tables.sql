ALTER TABLE "note_embeddings" RENAME TO "note_chunks";
ALTER TABLE "paper_embeddings" RENAME TO "paper_chunks";

ALTER TABLE "note_chunks" ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "paper_chunks" ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER INDEX IF EXISTS "note_embeddings_note_idx" RENAME TO "note_chunks_note_idx";
ALTER INDEX IF EXISTS "note_embeddings_embedding_idx" RENAME TO "note_chunks_embedding_idx";
ALTER INDEX IF EXISTS "paper_embeddings_paper_idx" RENAME TO "paper_chunks_paper_idx";
ALTER INDEX IF EXISTS "paper_embeddings_embedding_idx" RENAME TO "paper_chunks_embedding_idx";

-- Legacy ivfflat index names from early migrations.
ALTER INDEX IF EXISTS "note_embeddings_ivfflat_idx" RENAME TO "note_chunks_ivfflat_idx";
ALTER INDEX IF EXISTS "paper_embeddings_ivfflat_idx" RENAME TO "paper_chunks_ivfflat_idx";

-- Phase 1.5 integration note:
-- TODO(1.5/1.3x): add paperset_chunks when the paperset retrieval substrate
-- is finalized (library + ownership joins + chunk writer path).
