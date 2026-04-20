import { pgTable, text, timestamp, serial, integer, index } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const documentSections = pgTable(
  "document_sections",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    sectionIndex: integer("section_index").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("document_sections_document_idx").on(table.documentId)]
);
