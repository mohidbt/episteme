-- GSD-96 R1 fix: idempotency guard for /agents/embed-chunks.
--
-- Adds UNIQUE (paper_id, chunk_index) on document_chunks so retries of the
-- INSERT (Fluid Compute concurrency, network retries) collapse via
-- ON CONFLICT DO NOTHING instead of duplicating rows.
--
-- Pre-flight (2026-06-12): SELECT showed 0 duplicate (paper_id, chunk_index)
-- groups in prod, so the ADD CONSTRAINT lands clean without a backfill.
--
-- Apply role: owner-real (OWNER_DATABASE_URL / neondb_owner).
-- `document_chunks` is a legacy neondb_owner-owned table; ALTER TABLE under
-- migrate_only hits the ownership wall (per 2.3c discipline). Same role as
-- 0052_papers_chunks_ready_at.sql.

CREATE UNIQUE INDEX IF NOT EXISTS "document_chunks_paper_chunk_idx_unique"
  ON "document_chunks" ("paper_id", "chunk_index");
