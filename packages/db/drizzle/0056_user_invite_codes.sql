-- GSD-46 — per-user referral invite codes.
--
-- Each real user gets 5 referral codes (`episteme-{username}-{n}`, n=1..5).
-- Generated lazily once a username is set (end of signupRealUser).
-- Consumed at signup; consumed_by_user_id stamped on redemption.
--
-- NEW TABLE ONLY — migrate_only role safe.

CREATE TABLE IF NOT EXISTS "user_invite_codes" (
  "code" text PRIMARY KEY,
  "owner_user_id" text NOT NULL,
  "consumed_by_user_id" text,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "user_invite_codes"
    ADD CONSTRAINT "user_invite_codes_owner_user_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "user_invite_codes"
    ADD CONSTRAINT "user_invite_codes_consumed_by_user_id_fk"
    FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_user_invite_codes_owner"
  ON "user_invite_codes" ("owner_user_id");
