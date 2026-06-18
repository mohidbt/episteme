-- GSD-126 P0 — per-user managed OpenRouter buckets (Provisioning API).
--
-- One row per signed-in user, lazy-provisioned on first AI call. Holds
-- the OR-side hash (for /api/v1/keys/{hash} GET + PATCH) and the
-- encrypted runtime key (used as Authorization on completions). PK on
-- user_id only: lookup is always by user_id, and the unique constraint
-- doubles as race-safe lazy-provisioning via ON CONFLICT DO NOTHING.
--
-- or_key_encrypted is the base64url string emitted by
-- @episteme/auth#encrypt — matches user_api_keys.encrypted_key shape.
--
-- NEW TABLE ONLY — migrate_only role safe.

CREATE TABLE IF NOT EXISTS "user_openrouter_keys" (
  "user_id" text PRIMARY KEY,
  "or_key_hash" text NOT NULL,
  "or_key_encrypted" text NOT NULL,
  "limit_usd" numeric(10,4) NOT NULL DEFAULT 5,
  "limit_reset" text,
  "tier" text NOT NULL DEFAULT 'trial',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "user_openrouter_keys"
    ADD CONSTRAINT "user_openrouter_keys_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
