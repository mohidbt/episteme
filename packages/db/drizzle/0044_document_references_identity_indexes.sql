-- Identity-join indexes for document_references (H-batch codex follow-up).
--
-- cite-count.ts (getCrossLibraryCiteCounts) self-joins document_references
-- a ↔ b on DOI exact OR pg_trgm title fuzzy ≥ 0.6 to count cross-library
-- citers of the same underlying work. Without these indexes the join is
-- O(n²) over the user's document_references rows.
--
-- live-edges.ts edgesPaperCitations widened path (paper→docRef→paper /
-- paper→docRef→reference) also benefits from the DOI index on
-- document_references.
--
-- Mirrors 0043_paper_is_ref_identity_indexes.sql style:
--   * idx_document_references_doi_lower  — case/whitespace-insensitive DOI.
--                                          Partial: doi IS NOT NULL.
--   * idx_document_references_title_trgm — pg_trgm GIN on title for fuzzy
--                                          identity join.
--
-- pg_trgm already created in 0039 / 0043; CREATE EXTENSION IF NOT EXISTS
-- is a no-op when so.
--
-- document_references is owned by neondb_owner → apply via
-- apply-migrations.yml role=owner-real (CREATE INDEX requires table
-- ownership; the migrate_only role lacks ownership of this legacy table).

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_document_references_doi_lower
  ON document_references (lower(trim(doi)))
  WHERE doi IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_document_references_title_trgm
  ON document_references USING gin (title gin_trgm_ops)
  WHERE title IS NOT NULL;
