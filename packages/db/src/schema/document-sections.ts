import { pgTable, text, timestamp, serial, integer, uuid, index } from "drizzle-orm/pg-core";
import { papers } from "./papers";

export const documentSections = pgTable(
  "document_sections",
  {
    id: serial("id").primaryKey(),
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    sectionIndex: integer("section_index").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("document_sections_paper_idx").on(table.paperId)]
);
