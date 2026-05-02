import { pgTable, uuid, text, integer, vector, index, jsonb } from "drizzle-orm/pg-core";
import { notes } from "./notes";

export const noteEmbeddings = pgTable(
  "note_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("note_chunks_note_idx").on(t.noteId),
    index("note_chunks_embedding_idx").using("ivfflat", t.embedding.op("vector_cosine_ops")).with({ lists: 100 }),
  ],
);
