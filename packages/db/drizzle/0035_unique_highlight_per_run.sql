-- Round G — unique-per-run constraint on highlight tables.
--
-- Enforce uniqueness at DB level so duplicate inserts from the chat-agent
-- (paper_highlights) and the auto-highlight pipeline (user_highlights) are
-- rejected by Postgres rather than relying solely on reader-side dedup
-- (`dedup-paper-highlights.ts` from Round E stays as back-compat / belt and
-- braces).
--
-- Strategy
--   paper_highlights: bbox is jsonb. pg17 jsonb→text is deterministic
--     (sorted keys, normalized whitespace), so a unique expression index on
--     (run_id, page, (bbox::text)) is sufficient and avoids a new column.
--   user_highlights:  all scalar columns; straight unique index on
--     (layer_id, page_number, start_offset, end_offset).
--
-- Both indexes are partial — only enforced when the run-bearing key
-- (run_id / layer_id) is NOT NULL. Legacy hand-made highlights with NULL
-- run_id / layer_id continue to allow duplicates (back-compat).
--
-- Pre-cleanup
--   Before the indexes can be built, existing duplicate rows are deleted.
--   The EARLIEST row (smallest created_at) is kept per dedup-key, matching
--   the semantic of "first write wins" that the reader-side dedup already
--   approximates.
--
-- Lock posture
--   CREATE UNIQUE INDEX (non-CONCURRENTLY) takes ACCESS EXCLUSIVE on the
--   table. paper_highlights / user_highlights are low-traffic tables —
--   write-heavy only during interactive sessions. Bound blast radius with
--   lock_timeout. Re-run after lock-timeout is safe.

SET lock_timeout = '5s';--> statement-breakpoint

-- paper_highlights pre-cleanup: keep earliest per (run_id, page, bbox::text)
DELETE FROM "paper_highlights" p1
USING "paper_highlights" p2
WHERE p1.run_id IS NOT NULL
  AND p1.run_id = p2.run_id
  AND p1.page = p2.page
  AND p1.bbox::text = p2.bbox::text
  AND p1.created_at > p2.created_at;--> statement-breakpoint

-- user_highlights pre-cleanup: keep earliest per (layer_id, page_number, start_offset, end_offset)
DELETE FROM "user_highlights" u1
USING "user_highlights" u2
WHERE u1.layer_id IS NOT NULL
  AND u1.layer_id = u2.layer_id
  AND u1.page_number = u2.page_number
  AND u1.start_offset = u2.start_offset
  AND u1.end_offset = u2.end_offset
  AND u1.created_at > u2.created_at;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "paper_highlights_run_page_bbox_uk"
  ON "paper_highlights" (run_id, page, (bbox::text))
  WHERE run_id IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_highlights_layer_page_offsets_uk"
  ON "user_highlights" (layer_id, page_number, start_offset, end_offset)
  WHERE layer_id IS NOT NULL;
