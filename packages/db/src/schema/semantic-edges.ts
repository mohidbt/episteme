import { pgTable, uuid, text, real, timestamp, index, primaryKey } from "drizzle-orm/pg-core";

export const semanticEdges = pgTable(
  "semantic_edges",
  {
    userId: text("user_id").notNull(),
    srcKind: text("src_kind").notNull(),
    srcId: uuid("src_id").notNull(),
    dstKind: text("dst_kind").notNull(),
    dstId: uuid("dst_id").notNull(),
    weight: real("weight").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.srcKind, t.srcId, t.dstKind, t.dstId] }),
    index("semantic_edges_src").on(t.userId, t.srcKind, t.srcId),
    index("semantic_edges_dst").on(t.userId, t.dstKind, t.dstId),
  ],
);
