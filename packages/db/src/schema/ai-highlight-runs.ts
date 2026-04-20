import { pgTable, text, timestamp, integer, uuid, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { documents } from "./documents";
import { agentConversations } from "./agent-conversations";

// AI runs write user_highlights with layer_id = ai_highlight_runs.id
export const aiHighlightRuns = pgTable(
  "ai_highlight_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    instruction: text("instruction").notNull(),
    modelUsed: text("model_used"),
    status: text("status").notNull(), // 'running' | 'completed' | 'failed'
    summary: text("summary"),
    conversationId: integer("conversation_id").references(
      () => agentConversations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("ai_highlight_runs_document_idx").on(
      table.documentId,
      table.createdAt.desc(),
    ),
  ],
);
