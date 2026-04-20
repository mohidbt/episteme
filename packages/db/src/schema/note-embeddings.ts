import { pgTable, uuid, text, integer, vector, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";

export const noteEmbeddings = pgTable(
  "note_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [
    index("note_embeddings_note_idx").on(t.noteId),
    index("note_embeddings_embedding_idx").using("ivfflat", t.embedding.op("vector_cosine_ops")).with({ lists: 100 }),
  ],
);
