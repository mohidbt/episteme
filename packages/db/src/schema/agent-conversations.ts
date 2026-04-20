import { pgTable, text, timestamp, serial, integer, index } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { documents } from "./documents";

export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    title: text("title"),
    kind: text("kind").notNull().default("chat"), // 'chat' | 'explain-segment' | 'auto-highlight'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("agent_conversations_kind_idx").on(table.documentId, table.kind),
  ],
);
