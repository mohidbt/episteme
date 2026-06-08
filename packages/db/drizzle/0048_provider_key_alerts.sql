-- Global fallback API key exhaustion notifier — dedup + audit log.
--
-- One row per (provider, env_var, reason) currently active alert. Both
-- apps/km (TypeScript) and services/agents (Python) UPSERT into this table
-- when a provider call using a *fallback* env-var key returns 401, 402, or
-- sustained 429. The notifier reads last_alerted_at to dedupe outbound email
-- (Resend) within a 1-hour window. Operator-cleared rows set cleared_at to
-- release the unique slot and start a fresh history.
--
-- Identity rules:
--   * provider     — short canonical name: 'openrouter' | 'tavily' |
--                    'semantic_scholar' | 'chandra'.
--   * env_var      — exact env var that held the failing key (e.g.
--                    'EPISTEME_SHARED_LLM_KEY') so two OpenRouter fallback
--                    keys produce distinct rows.
--   * reason       — 'key_invalid' | 'key_exhausted' | 'key_rate_limited'.
--
-- The partial unique index on (provider, env_var, reason) WHERE
-- cleared_at IS NULL keeps one active row per slot but allows historical
-- rows to coexist after operator-clear.

CREATE TABLE IF NOT EXISTS "provider_key_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL,
  "env_var" text NOT NULL,
  "reason" text NOT NULL,
  "hit_count" integer NOT NULL DEFAULT 0,
  "sample_error" text,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_alerted_at" timestamptz,
  "cleared_at" timestamptz
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_key_alerts_active_unique"
  ON "provider_key_alerts" ("provider", "env_var", "reason")
  WHERE "cleared_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_key_alerts_last_seen"
  ON "provider_key_alerts" ("last_seen_at" DESC);
