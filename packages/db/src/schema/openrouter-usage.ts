import {
  bigserial,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Per-identity OpenRouter call audit log. See drizzle/0034_openrouter_usage.sql
// for the identity rules (user_id XOR guest_session_id).
export const openrouterUsage = pgTable(
  "openrouter_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id"),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    // numeric(10,6) — stored as string by postgres-js; parse when summing.
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 })
      .default("0")
      .notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userTsIdx: index("idx_or_usage_user_ts").on(t.userId, t.createdAt.desc()),
    guestTsIdx: index("idx_or_usage_guest_ts").on(
      t.guestSessionId,
      t.createdAt.desc(),
    ),
  }),
);
