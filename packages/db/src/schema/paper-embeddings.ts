import { pgTable, uuid, text, integer, vector, index, jsonb } from "drizzle-orm/pg-core";
import { papers } from "./papers";

export const paperEmbeddings = pgTable(
  "paper_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("paper_chunks_paper_idx").on(t.paperId),
    index("paper_chunks_embedding_idx").using("ivfflat", t.embedding.op("vector_cosine_ops")).with({ lists: 100 }),
  ],
);
