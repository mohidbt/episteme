import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

// Invite-code allowlist — see drizzle/0036_paper_citations_invites.sql.
export const inviteCodes = pgTable(
  "invite_codes",
  {
    code: text("code").primaryKey(),
    usedByUserId: text("used_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // Partial index — mirrors `WHERE "used_by_user_id" IS NOT NULL` in SQL.
    usedByIdx: index("idx_invite_used_by")
      .on(t.usedByUserId)
      .where(sql`${t.usedByUserId} IS NOT NULL`),
  }),
);
