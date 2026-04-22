import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { user } from "./auth";

export const revisionReasonEnum = pgEnum("revision_reason", ["autosave", "manual", "pre-ai-edit", "conflict-resolve"]);

export const noteRevisions = pgTable(
  "note_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    contentMd: text("content_md").notNull(),
    reason: revisionReasonEnum("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("note_revisions_note_id_created_at_id_idx").on(
      t.noteId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);
