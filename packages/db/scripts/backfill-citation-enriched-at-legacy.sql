-- GSD-74 follow-up: stamp enriched_at on already-enriched legacy
-- document_references. See backfill-citation-enriched-at-legacy.ts for the
-- preferred entrypoint (provides DRY_RUN guard + candidate count).
--
-- Run via Neon dashboard or psql w/ OWNER_DATABASE_URL.
-- Idempotent. Safe to re-run.
UPDATE document_references
SET enriched_at = NOW()
WHERE enriched_at IS NULL
  AND (
    semantic_scholar_id IS NOT NULL
    OR citation_count IS NOT NULL
    OR venue IS NOT NULL
    OR abstract IS NOT NULL
  );
