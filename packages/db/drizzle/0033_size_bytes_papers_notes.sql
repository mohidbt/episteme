-- Round B (DRIVE-USE): per-library 100 MB hard cap.
--
-- Adds `size_bytes` to `papers` and `notes` so the library-usage helper can
-- SUM(size_bytes) across kinds (papers, notes, assets — assets already has
-- the column). Default 0 keeps pre-existing rows valid; NOT NULL means new
-- code must always populate it.
--
-- Backfill rules:
--   * notes: derive from octet_length(content_md) — byte length of the
--     markdown body. Backfills cheaply in one UPDATE; matches what the
--     write path will compute going forward.
--   * papers: leave at 0. The authoritative byte count lives on R2/MinIO,
--     not in Postgres, so a real backfill needs an out-of-band HEAD-each-key
--     pass. See TODO below.
--
-- TODO(B-followup): one-shot script `scripts/backfill-paper-size-bytes.ts`
-- to HEAD storage_url for every row, write size_bytes, run once against
-- prod after this migration applies. Until then, papers contribute 0 to
-- the cap and the cap is effectively notes+assets-only on legacy data.

ALTER TABLE "papers" ADD COLUMN "size_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "size_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "notes" SET "size_bytes" = octet_length("content_md");
