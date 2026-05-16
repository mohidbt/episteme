-- Backfill: scrub InDesign filename prefix + zero-width chars from
-- document_references rows extracted before the annotation-extractor
-- sanitizer fix shipped (c0ed8b9). See apps/km/src/lib/citations/annotation-extractor.ts.
--
-- Affected: Springer Nature PDFs (springernature_*.indd) whose annotation
-- extraction path landed corrupt rawText / empty title for some references.
--
-- This UPDATE only cleans rawText + title prefixes. It does NOT recover
-- structured fields (authors/year/doi) — for full recovery, run a
-- per-paper re-extract via POST /api/papers/[id]/citations/extract after
-- this backfill. The visible UI improvement is immediate: titles stop
-- showing the .indd filename garbage.
--
-- document_references is owned by neondb_owner → apply via
-- apply-migrations.yml role=owner-real.

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
