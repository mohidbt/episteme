-- GSD-141 — Stripe payment linkage on user_subscriptions.
--
-- checkout.session.completed stores stripe_customer_id + stripe_subscription_id
-- + price_id; later subscription.updated/.deleted webhooks reverse-look-up the
-- user by stripe_customer_id (hence the index).
--
-- All columns nullable: pre-GSD-141 rows (created by the state machine in tests
-- or manual grants) have no Stripe linkage. ADD COLUMN only — migrate_only safe
-- (user_subscriptions was created by migrate_only in 0060).

ALTER TABLE "user_subscriptions"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" text,
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text,
  ADD COLUMN IF NOT EXISTS "price_id" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_subscriptions_stripe_customer_id_idx"
  ON "user_subscriptions" ("stripe_customer_id");
