-- Round C (OR-USAGE): track per-identity OpenRouter spend.
--
-- One row per OpenRouter call (ai-fill, km-agent, ...) capturing token counts
-- and computed USD cost (catalog price × tokens). The aggregate helper sums
-- these rows over a 30-day window to drive the soft warn in /settings/data.
--
-- Identity:
--   * Signed-in users → user_id set, guest_session_id NULL.
--   * Guest (anonymous) users → user_id NULL, guest_session_id = anon user id.
--   Separate audit trail by design; guest rows are NOT transferred to user_id
--   on signup. Documented in apps/km/src/lib/openrouter-usage.ts.
--
-- Cost compute: prompt_tokens * pricing.prompt + completion_tokens *
-- pricing.completion, where pricing comes from openrouter_catalog.payload
-- (USD per token, as a string). Stored as numeric(10,6) → six decimal places
-- is enough resolution for sub-cent per-call costs while staying well below
-- numeric overflow for any plausible monthly spend.

CREATE TABLE IF NOT EXISTS "openrouter_usage" (
  "id" bigserial PRIMARY KEY,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "guest_session_id" text,
  "model" text NOT NULL,
  "prompt_tokens" integer NOT NULL DEFAULT 0,
  "completion_tokens" integer NOT NULL DEFAULT 0,
  "cost_usd" numeric(10,6) NOT NULL DEFAULT 0,
  "source" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_or_usage_user_ts" ON "openrouter_usage"("user_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_or_usage_guest_ts" ON "openrouter_usage"("guest_session_id","created_at" DESC) WHERE "guest_session_id" IS NOT NULL;
