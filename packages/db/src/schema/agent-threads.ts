import { pgTable, text, timestamp, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const agentThreadStatusEnum = pgEnum("agent_thread_status", ["idle", "running", "awaiting_hitl", "error"]);

export const agentThreads = pgTable(
  "agent_threads",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    modelOverride: text("model_override"),
    title: text("title"),
    skill: text("skill"),
    status: agentThreadStatusEnum("status").default("idle").notNull(),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.threadId] }),
  ],
);
