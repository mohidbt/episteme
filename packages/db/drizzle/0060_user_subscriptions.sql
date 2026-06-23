-- GSD-140 P1 — paid subscription state (one row per user).
--
-- Written by GSD-141 Stripe webhooks (out of scope in GSD-140); read by the
-- bucket state-machine (apps/km/src/lib/subscription-bucket.ts) to decide the
-- managed OpenRouter bucket's weekly limit.
--
--   tier   — 'high' | 'max' (lib/subscription-tiers.ts → bucket USD limit 2/4)
--   status — 'active' | 'canceled'
--   current_period_* — Stripe billing window; nullable until first webhook.
--
-- PK on user_id only: one subscription per user. The cancel/resume state
-- machine keeps the row (status flag) so resume re-uses the stored tier.
--
-- NEW TABLE ONLY — migrate_only role safe.

CREATE TABLE IF NOT EXISTS "user_subscriptions" (
  "user_id" text PRIMARY KEY,
  "tier" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "current_period_start" timestamptz,
  "current_period_end" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "user_subscriptions"
    ADD CONSTRAINT "user_subscriptions_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
