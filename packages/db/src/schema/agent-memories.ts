import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    namespace: text("namespace").array().notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("agent_memories_user_ns_idx").on(t.userId, t.namespace)],
);
