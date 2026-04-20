import { pgTable, text, timestamp, serial, integer, index, unique } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { documentReferences } from "./document-references";
import { libraryReferences } from "./library-references";

export const keptCitations = pgTable("kept_citations", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  documentReferenceId: integer("document_reference_id")
    .notNull()
    .references(() => documentReferences.id, { onDelete: "cascade" }),
  libraryReferenceId: integer("library_reference_id")
    .references(() => libraryReferences.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kept_citations_user_id_idx").on(table.userId),
  unique("kept_citations_user_doc_ref_unique").on(table.userId, table.documentReferenceId),
]);
