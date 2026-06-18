import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

// GSD-126 P0 — per-user managed OpenRouter buckets (Provisioning API).
//
// One row per signed-in user once they hit an AI feature for the first
// time. Holds the OR-side `hash` (used for GET/PATCH usage lookups) and
// the encrypted runtime key (used as the completions Authorization).
//
// `or_key_encrypted` is the base64url string emitted by
// @episteme/auth#encrypt — same format as user_api_keys.encrypted_key.
//
// `limit_reset` mirrors OpenRouter's `limit_reset` field:
//   null   → one-time bucket (P0 trial)
//   weekly → P1 subscription tiers (Mon-Sun UTC reset)
//   daily / monthly → reserved for future tiers
//
// PK on user_id only: lookup is always by user_id, and the unique
// constraint doubles as race-safe lazy-provisioning via
// `ON CONFLICT (user_id) DO NOTHING` + re-read.
export const userOpenrouterKeys = pgTable("user_openrouter_keys", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  orKeyHash: text("or_key_hash").notNull(),
  orKeyEncrypted: text("or_key_encrypted").notNull(),
  limitUsd: numeric("limit_usd", { precision: 10, scale: 4 })
    .notNull()
    .default("5"),
  limitReset: text("limit_reset"),
  tier: text("tier").notNull().default("trial"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
