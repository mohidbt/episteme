import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Dedup + audit log for global fallback provider key exhaustion alerts.
// Both apps/km (TS) and services/agents (Python) UPSERT here so the dedup
// window is shared across runtimes/instances. See drizzle/0048_provider_key_alerts.sql.
export const providerKeyAlerts = pgTable(
  "provider_key_alerts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    envVar: text("env_var").notNull(),
    reason: text("reason").notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    sampleError: text("sample_error"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
  },
  (t) => ({
    activeUniqIdx: uniqueIndex("provider_key_alerts_active_unique")
      .on(t.provider, t.envVar, t.reason)
      .where(sql`${t.clearedAt} IS NULL`),
    lastSeenIdx: index("idx_provider_key_alerts_last_seen").on(
      t.lastSeenAt.desc(),
    ),
  }),
);
