import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

// GSD-46 — per-user referral codes (5 per user, format `episteme-{username}-{n}`).
// Distinct from `invite_codes` (admin allowlist): every real user gets a personal
// fan-out pool. Consumption stamps the row, mirroring the existing gate's pattern.
export const userInviteCodes = pgTable(
  "user_invite_codes",
  {
    code: text("code").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    consumedByUserId: text("consumed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("idx_user_invite_codes_owner").on(t.ownerUserId),
  }),
);
