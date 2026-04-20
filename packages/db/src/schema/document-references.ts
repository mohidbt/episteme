import { pgTable, text, timestamp, serial, integer, index, jsonb } from "drizzle-orm/pg-core";
import { documents } from "./documents";
type Author = { name: string; authorId?: string };

export const documentReferences = pgTable("document_references", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  markerText: text("marker_text").notNull(),
  markerIndex: integer("marker_index").notNull(),
  rawText: text("raw_text"),
  title: text("title"),
  authors: jsonb("authors").$type<Author[]>(),
  year: text("year"),
  doi: text("doi"),
  url: text("url"),
  semanticScholarId: text("semantic_scholar_id"),
  abstract: text("abstract"),
  venue: text("venue"),
  citationCount: integer("citation_count"),
  pageNumber: integer("page_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Phase 2.2: Semantic Scholar enrichment
  influentialCitationCount: integer("influential_citation_count"),
  openAccessPdfUrl: text("open_access_pdf_url"),
  tldrText: text("tldr_text"),
  externalIds: jsonb("external_ids").$type<Record<string, string>>(),
  bibtex: text("bibtex"),
}, (table) => [
  index("document_references_document_id_idx").on(table.documentId),
]);
