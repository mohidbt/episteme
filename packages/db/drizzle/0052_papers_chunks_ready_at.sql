-- GSD-96 R1: papers.chunks_ready_at — set by /agents/embed-chunks after
-- both chunk rows + embeddings are persisted (single INSERT covers both).
--
-- Consumed by GET /api/papers/[id]/ingest-status to gate chat send and
-- (per GSD-99) by drive sidebar / drive page / refs list / graph / citation
-- card "analyzing" indicators.
--
-- Apply role: owner-real (OWNER_DATABASE_URL / neondb_owner).
-- `papers` is a legacy neondb_owner-owned table; ALTER TABLE under
-- migrate_only hits the ownership wall (per 2.3c discipline).

ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "chunks_ready_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "papers_user_chunks_ready_idx"
  ON "papers" ("user_id", "chunks_ready_at");
