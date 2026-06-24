import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

// GSD-140 — paid subscription state (one row per user).
//
// Written by GSD-141 Stripe webhooks (out of scope here); read by the
// bucket state-machine to decide the managed OR bucket's weekly limit.
//
//   tier   — 'high' | 'max' (see lib/subscription-tiers.ts → bucket limit)
//   status — 'active' | 'canceled'
//   current_period_* — Stripe billing window (nullable until first webhook)
//
// PK on user_id: one subscription per user. NEW TABLE — migrate_only safe.
export const userSubscriptions = pgTable("user_subscriptions", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  tier: text("tier").notNull(),
  status: text("status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
