import { pgTable, text, timestamp, serial, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { agentConversations } from "./agent-conversations";

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export const agentMessages = pgTable("agent_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => agentConversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  viewportContext: jsonb("viewport_context"),  // { page: number, scrollPct: number }
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
