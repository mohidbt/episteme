// GSD-96 R3 — recents source for empty-query @-picker state.
//
// One row per (user, kind, item) the user opened. Helper trims to 50
// most-recent rows per user post-upsert (see touch-recents.ts).
//
// kind = 'paper' | 'note' | 'reference' | 'paperset' — DB-enforced via CHECK
// (see 0054_user_library_recents.sql). itemId is a uuid in every kind today.

import { pgTable, text, uuid, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const userLibraryRecents = pgTable(
  "user_library_recents",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    itemId: uuid("item_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.itemId] }),
    index("user_library_recents_user_opened_idx").on(t.userId, t.openedAt),
  ],
);
