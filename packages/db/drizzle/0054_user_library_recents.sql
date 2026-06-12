-- GSD-96 R3 — recents source for empty-query @-picker state in chat composer.
--
-- One row per (user, kind, item) the user opened. Touch helper
-- (apps/km/src/lib/library/touch-recents.ts) upserts on open events, then
-- post-upsert deletes anything beyond the 50 most-recent rows for that user.
--
-- kind discriminates entity tables: paper | note | reference | paperset.
-- item_id is uuid in every kind today.
--
-- Apply role: migrate_only (brand-new table; no legacy ownership wall).

CREATE TABLE IF NOT EXISTS "user_library_recents" (
  "user_id" text NOT NULL,
  "kind" text NOT NULL,
  "item_id" uuid NOT NULL,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_library_recents_pkey" PRIMARY KEY ("user_id", "kind", "item_id"),
  CONSTRAINT "user_library_recents_kind_check"
    CHECK ("kind" IN ('paper','note','reference','paperset'))
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "user_library_recents"
    ADD CONSTRAINT "user_library_recents_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_library_recents_user_opened_idx"
  ON "user_library_recents" ("user_id", "opened_at" DESC);
