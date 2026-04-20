import { pgTable, serial, integer, real, timestamp, index } from "drizzle-orm/pg-core";
import { documentReferences } from "./document-references";

export const documentReferenceMarkers = pgTable("document_reference_markers", {
  id: serial("id").primaryKey(),
  referenceId: integer("reference_id")
    .notNull()
    .references(() => documentReferences.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  x0: real("x0").notNull(),
  y0: real("y0").notNull(),
  x1: real("x1").notNull(),
  y1: real("y1").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("document_reference_markers_reference_id_idx").on(table.referenceId),
]);
