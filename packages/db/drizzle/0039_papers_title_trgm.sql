-- pg_trgm index for papers.title to support fuzzy title match in auto-link.
--
-- Replaces the prior JS-side LIMIT 500 candidate scan in
-- apps/km/src/lib/citations/auto-link.ts, which silently missed matches once
-- the papers table exceeded the cap.
--
-- Apply role: owner-real (papers table is owned by neondb_owner; CREATE INDEX
-- requires table ownership). pg_trgm extension on Neon is created by the
-- owner; CREATE EXTENSION IF NOT EXISTS is a no-op if already present.

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_papers_title_trgm
  ON papers USING gin (title gin_trgm_ops);
