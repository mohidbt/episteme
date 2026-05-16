-- Backfill: scrub InDesign filename prefix + zero-width chars from
-- document_references rows extracted before the annotation-extractor
-- sanitizer fix shipped. See apps/km/src/lib/citations/annotation-extractor.ts.
--
-- Affected: Springer Nature PDFs (springernature_*.indd) whose annotation
-- extraction path landed corrupt rawText / empty title for some references.
--
-- Strategy: prefer a no-data-mutation path — issue a re-extract via the
-- `/api/papers/[id]/citations/extract` endpoint per affected paper, which
-- now sanitizes at insert time. Use this SQL only if a re-extract is not
-- feasible (e.g. source PDF gone) — it will not recover the title field,
-- only clean the rawText so the UI fallback stops showing the .indd prefix.
--
-- DO NOT run unattended against prod. Inspect affected rows first.

-- 1) Inspect:
SELECT id, paper_id, marker_index, left(raw_text, 80) AS raw_preview, title
FROM document_references
WHERE raw_text ~ E'\\.indd[:.]'
   OR raw_text ~ E'[\\uFEFF\\u200B\\u200C\\u200D\\u00AD]'
   OR title    ~ E'\\.indd[:.]'
   OR title    ~ E'[\\uFEFF\\u200B\\u200C\\u200D\\u00AD]'
ORDER BY paper_id, marker_index
LIMIT 200;

-- 2) Backfill (dry-run first by wrapping in BEGIN / ROLLBACK):
-- BEGIN;
UPDATE document_references
SET
  raw_text = regexp_replace(
    regexp_replace(raw_text, E'[\\uFEFF\\u200B\\u200C\\u200D\\u00AD]', '', 'g'),
    E'^\\S+\\.indd\\s*:\\s*',
    '',
    'i'
  ),
  title = NULLIF(
    regexp_replace(
      regexp_replace(coalesce(title, ''), E'[\\uFEFF\\u200B\\u200C\\u200D\\u00AD]', '', 'g'),
      E'^\\S+\\.indd\\s*:\\s*',
      '',
      'i'
    ),
    ''
  )
WHERE raw_text ~ E'\\.indd[:.]'
   OR raw_text ~ E'[\\uFEFF\\u200B\\u200C\\u200D\\u00AD]'
   OR title    ~ E'\\.indd[:.]'
   OR title    ~ E'[\\uFEFF\\u200B\\u200C\\u200D\\u00AD]';
-- COMMIT;
