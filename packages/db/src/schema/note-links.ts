import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";

export const noteLinkTargetKindEnum = pgEnum("note_link_target_kind", ["note", "paper", "reference"]);

export const noteLinks = pgTable(
  "note_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceNoteId: uuid("source_note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    targetKind: noteLinkTargetKindEnum("target_kind").notNull(),
    targetId: uuid("target_id"),
    targetTitleRaw: text("target_title_raw").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("note_links_source_idx").on(t.sourceNoteId),
    index("note_links_target_idx").on(t.targetKind, t.targetId),
  ],
);
