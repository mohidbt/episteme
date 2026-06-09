-- GSD-32 Phase 2: scaffold column for paper/ref collapse merge.
--
-- abstract_short is filled at read time from a matched library reference's
-- CSL JSON `abstract` (trimmed app-side to ~500 chars). Nullable; no CHECK
-- constraint — trimming policy stays in TS so we don't double-enforce.
--
-- No backfill here. Phase 4 auto-creates a `references_` twin per paper;
-- Phase 3 merges at read time. CSL container-title is mapped to existing
-- `papers.venue` — no new column needed for it.

ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "abstract_short" text;
