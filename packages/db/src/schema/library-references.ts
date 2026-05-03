import { pgTable, text, timestamp, serial, integer, index, uniqueIndex, jsonb, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { folders } from "./folders";
type Author = { name: string; authorId?: string };

export const libraryReferences = pgTable("library_references", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  authors: jsonb("authors").$type<Author[]>(),
  year: text("year"),
  doi: text("doi"),
  url: text("url"),
  semanticScholarId: text("semantic_scholar_id"),
  abstract: text("abstract"),
  venue: text("venue"),
  citationCount: integer("citation_count"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  // Phase 2.2: Semantic Scholar enrichment
  influentialCitationCount: integer("influential_citation_count"),
  openAccessPdfUrl: text("open_access_pdf_url"),
  tldrText: text("tldr_text"),
  externalIds: jsonb("external_ids").$type<Record<string, string>>(),
  bibtex: text("bibtex"),
  folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
}, (table) => [
  index("library_references_user_id_idx").on(table.userId),
  index("library_references_folder_idx").on(table.userId, table.folderId),
  // Partial unique index — enforces per-user DOI uniqueness only for rows with a DOI.
  // Enables race-free ON CONFLICT upsert in save route; rows without a DOI remain duplicable.
  uniqueIndex("library_references_user_doi_unique_idx")
    .on(table.userId, table.doi)
    .where(sql`${table.doi} IS NOT NULL`),
]);
