import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { papers } from "./papers";
import { user } from "./auth";

export const paperHighlights = pgTable(
  "paper_highlights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    bbox: jsonb("bbox"),
    runId: text("run_id"),
    toolCallId: text("tool_call_id"),
    color: text("color"),
    noteMd: text("note_md"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("paper_highlights_paper_idx").on(t.paperId)],
);
