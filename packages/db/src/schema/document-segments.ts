import { pgTable, text, timestamp, serial, integer, uuid, index, jsonb } from "drizzle-orm/pg-core";
import { papers } from "./papers";

export type DocumentSegmentKind = "section_header" | "figure" | "formula" | "paragraph" | "table";

export type DocumentSegmentBbox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type DocumentSegmentPayload = {
  latex?: string;
  caption?: string;
  heading_level?: number;
  text?: string;
};

export const documentSegments = pgTable(
  "document_segments",
  {
    id: serial("id").primaryKey(),
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    kind: text("kind").$type<DocumentSegmentKind>().notNull(),
    bbox: jsonb("bbox").$type<DocumentSegmentBbox>().notNull(),
    payload: jsonb("payload").$type<DocumentSegmentPayload>().notNull(),
    orderIndex: integer("order_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_segments_paper_page_idx").on(table.paperId, table.page),
  ]
);
