import { pgTable, uuid, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

export const pendingRecompute = pgTable(
  "pending_recompute",
  {
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    nodeId: uuid("node_id").notNull(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    tries: integer("tries").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.nodeId] }),
    index("pending_recompute_enqueued").on(t.enqueuedAt),
    index("pending_recompute_claimed").on(t.claimedAt),
  ],
);
