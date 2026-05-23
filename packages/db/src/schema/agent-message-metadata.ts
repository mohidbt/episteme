import { pgTable, text, timestamp, jsonb, primaryKey, index } from "drizzle-orm/pg-core";
import { user } from "./auth";

// Per-message extras for agent threads. Generic kind/payload shape so future
// per-message data (grounding, todos snapshot, alternative sources) reuses
// the same table without schema churn. First consumer: citations.
//
// Owner column is mandatory — thread_id is user-supplied at /invoke and
// cannot be the sole tenant boundary. /state reads filter by (user_id,
// thread_id) for defense-in-depth on top of the route-level auth gate.
export const agentMessageMetadata = pgTable(
  "agent_message_metadata",
  {
    threadId: text("thread_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.messageId, t.kind] }),
    index("agent_message_metadata_user_id_idx").on(t.userId),
    index("agent_message_metadata_thread_id_idx").on(t.threadId),
  ],
);
