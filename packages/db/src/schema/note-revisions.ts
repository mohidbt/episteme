import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { user } from "./auth";

export const revisionReasonEnum = pgEnum("revision_reason", ["autosave", "manual", "pre-ai-edit", "conflict-resolve"]);

export const noteRevisions = pgTable("note_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
  contentMd: text("content_md").notNull(),
  reason: revisionReasonEnum("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
