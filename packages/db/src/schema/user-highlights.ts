import { pgTable, text, timestamp, serial, integer, pgEnum, index, uniqueIndex, uuid, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { papers } from "./papers";

export const highlightColorEnum = pgEnum("highlight_color", [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
  "amber",
]);

export const highlightSourceEnum = pgEnum("highlight_source", ["user", "ai-auto"]);

export const userHighlights = pgTable("user_highlights", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  paperId: uuid("paper_id")
    .notNull()
    .references(() => papers.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  textContent: text("text_content").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  color: highlightColorEnum("color").notNull().default("yellow"),
  note: text("note"),
  source: highlightSourceEnum("source").notNull().default("user"),
  layerId: uuid("layer_id"),
  comment: text("comment"),
  rects: jsonb("rects"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
},
(table) => [
  index("user_highlights_user_paper_idx").on(table.userId, table.paperId),
  index("user_highlights_layer_idx").on(table.layerId),
  uniqueIndex("user_highlights_layer_page_offsets_uk")
    .on(table.layerId, table.pageNumber, table.startOffset, table.endOffset)
    .where(sql`layer_id IS NOT NULL`),
]);
