import { pgTable, text, timestamp, serial, integer, uuid, index, vector } from "drizzle-orm/pg-core";
import { papers } from "./papers";
import { documentSections } from "./document-sections";

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: serial("id").primaryKey(),
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    sectionId: integer("section_id").references(() => documentSections.id, { onDelete: "set null" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_chunks_paper_idx").on(table.paperId),
    index("document_chunks_embedding_idx")
      .using("ivfflat", table.embedding.op("vector_cosine_ops"))
      .with({ lists: 100 }),
  ]
);
