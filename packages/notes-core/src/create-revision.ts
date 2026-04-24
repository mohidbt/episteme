import { desc, eq } from "drizzle-orm";
import { db } from "@episteme/db";
import { noteRevisions, notes } from "@episteme/db/schema";
import { pruneRevisions } from "./prune-revisions";

const DELTA_MIN = 50;
const AGE_MIN_MS = 5 * 60 * 1000;

export type RevisionReason = "autosave" | "manual" | "pre-ai-edit" | "conflict-resolve";

export type InsertedRevision = {
  id: string;
  noteId: string;
  authorId: string | null;
  contentMd: string;
  reason: RevisionReason;
  createdAt: Date;
};

export async function createRevisionIfNeeded(input: {
  noteId: string;
  authorId: string | null;
  newMd: string;
  reason: RevisionReason;
}): Promise<InsertedRevision | null> {
  if (input.reason === "autosave") {
    const [cur] = await db
      .select({ contentMd: notes.contentMd })
      .from(notes)
      .where(eq(notes.id, input.noteId));
    const delta = Math.abs((cur?.contentMd?.length ?? 0) - input.newMd.length);
    const [last] = await db
      .select({ createdAt: noteRevisions.createdAt })
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, input.noteId))
      .orderBy(desc(noteRevisions.createdAt))
      .limit(1);
    const age = last ? Date.now() - last.createdAt.getTime() : Infinity;
    if (delta <= DELTA_MIN && age <= AGE_MIN_MS) return null;
  }
  const [row] = await db
    .insert(noteRevisions)
    .values({
      noteId: input.noteId,
      authorId: input.authorId,
      contentMd: input.newMd,
      reason: input.reason,
    })
    .returning();
  if (input.reason === "autosave") {
    await pruneRevisions(input.noteId);
  }
  return row as InsertedRevision;
}

export function createPreAIEditRevision(
  noteId: string,
  authorId: string | null,
  currentMd: string,
): Promise<InsertedRevision | null> {
  return createRevisionIfNeeded({ noteId, authorId, newMd: currentMd, reason: "pre-ai-edit" });
}
