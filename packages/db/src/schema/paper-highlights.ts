import { pgTable, uuid, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { papers } from "./papers";
import { user } from "./auth";

export const paperHighlights = pgTable("paper_highlights", {
  id: uuid("id").defaultRandom().primaryKey(),
  paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  page: integer("page").notNull(),
  bbox: jsonb("bbox"),
  color: text("color"),
  noteMd: text("note_md"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
