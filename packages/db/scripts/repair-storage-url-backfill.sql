-- G6 repair: backfill storage_url for papers with chandra_status in ('running','done','failed')
-- that were missing storage_url (predeploy gate: papers.storage_url_present_for_parse_active_rows).
--
-- Root cause: paper 3703d13e-4f17-4a81-a7fb-9788d08ad570 had chandra_status='done' and
-- 71 document_segments (parse completed successfully) but storage_url was never written back.
-- The canonical key <paper_uuid>/source.pdf matches paperSourceKey() in apps/km/src/lib/storage.ts.
--
-- Applied to prod: 2026-05-13. 1 row affected.
-- Run predeploy-check after to verify all ok.

UPDATE papers
SET storage_url = id::text || '/source.pdf'
WHERE chandra_status IN ('running', 'done', 'failed')
  AND storage_url IS NULL;

-- Verify: should return 0
SELECT COUNT(*)
FROM papers
WHERE chandra_status IN ('running', 'done', 'failed')
  AND storage_url IS NULL;
