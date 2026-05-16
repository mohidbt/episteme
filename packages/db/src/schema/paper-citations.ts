import {
  bigserial,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Polymorphic citation edge — see drizzle/0036_paper_citations_invites.sql.
// citer_kind/cited_kind ∈ {'paper','reference'}; the corresponding id column
// holds either a paper UUID (as text) or a document_references serial (as text)
// — schema-level CHECKs enforce kind only; FK enforcement is intentionally
// skipped because the target table varies by kind.
export const paperCitations = pgTable(
  "paper_citations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    citerKind: text("citer_kind").$type<"paper" | "reference">().notNull(),
    citerId: text("citer_id").notNull(),
    citedKind: text("cited_kind").$type<"paper" | "reference">().notNull(),
    citedId: text("cited_id").notNull(),
    sourceMarkerIdx: integer("source_marker_idx"),
    matchMethod: text("match_method")
      .$type<"doi" | "title-fuzzy" | "manual">()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    citerIdx: index("idx_pc_citer").on(t.citerKind, t.citerId),
    citedIdx: index("idx_pc_cited").on(t.citedKind, t.citedId),
    uniq: unique().on(t.citerKind, t.citerId, t.citedKind, t.citedId),
  }),
);
