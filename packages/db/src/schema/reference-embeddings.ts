import { pgTable, uuid, vector, timestamp, index } from "drizzle-orm/pg-core";
import { references_ } from "./references";

export const referenceEmbeddings = pgTable(
  "reference_embeddings",
  {
    referenceId: uuid("reference_id")
      .primaryKey()
      .references(() => references_.id, { onDelete: "cascade" }),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reference_embeddings_emb_idx")
      .using("ivfflat", t.embedding.op("vector_cosine_ops"))
      .with({ lists: 100 }),
  ],
);
