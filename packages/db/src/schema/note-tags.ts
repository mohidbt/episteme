import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";

export const noteTags = pgTable(
  "note_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("note_tags_note_tag_unique").on(t.noteId, t.tag),
    index("note_tags_tag_idx").on(t.tag),
  ],
);
