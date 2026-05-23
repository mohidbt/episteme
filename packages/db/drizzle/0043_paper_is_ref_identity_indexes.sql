-- Identity-join indexes for paper_is_ref semantic fix (H-batch).
--
-- The graph helper edgesPaperIsRef in apps/km/src/lib/graph/live-edges.ts is
-- being rewritten to join papers ↔ references on identity (DOI exact OR
-- pg_trgm title fuzzy ≥ 0.6) instead of the legacy references_.paperId field.
-- The widened edgesPaperCitations also joins document_references → references
-- by DOI / fuzzy title to surface citing/cited_in edges into library
-- references.
--
-- New indexes:
--   * idx_papers_doi_lower         — case/whitespace-insensitive DOI lookup
--                                    on papers. Partial: doi IS NOT NULL.
--   * idx_references_doi_lower     — same shape over csl_json->>'DOI'
--                                    (references has no top-level doi column;
--                                    DOI lives inside csl_json).
--   * idx_references_title_trgm    — pg_trgm GIN on csl_json->>'title' for
--                                    the fuzzy identity join. references has
--                                    no top-level title column either.
--
-- pg_trgm extension is already present (created in migration 0039 for
-- papers.title); CREATE EXTENSION IF NOT EXISTS is a no-op when so.
--
-- papers + references are owned by neondb_owner → apply via
-- apply-migrations.yml role=owner-real (CREATE INDEX requires table
-- ownership; the migrate_only role lacks ownership of these legacy tables).

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_papers_doi_lower
  ON papers (lower(trim(doi)))
  WHERE doi IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_references_doi_lower
  ON "references" (lower(trim(csl_json->>'DOI')))
  WHERE csl_json->>'DOI' IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_references_title_trgm
  ON "references" USING gin ((csl_json->>'title') gin_trgm_ops)
  WHERE csl_json->>'title' IS NOT NULL;
