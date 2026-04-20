import { pgTable, uuid, text, integer, vector, index } from "drizzle-orm/pg-core";
import { papers } from "./papers";

export const paperEmbeddings = pgTable(
  "paper_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [index("paper_embeddings_paper_idx").on(t.paperId)],
);
