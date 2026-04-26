import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@episteme/db";
import { noteRevisions } from "@episteme/db/schema";

const AUTOSAVE_KEEP = 200;

export async function pruneRevisions(noteId: string): Promise<void> {
  // Keep-set: ids of the latest AUTOSAVE_KEEP autosave rows for this note,
  // ordered by (created_at DESC, id DESC) to match the composite index.
  const keepIds = await db
    .select({ id: noteRevisions.id })
    .from(noteRevisions)
    .where(and(eq(noteRevisions.noteId, noteId), eq(noteRevisions.reason, "autosave")))
    .orderBy(sql`${noteRevisions.createdAt} DESC, ${noteRevisions.id} DESC`)
    .limit(AUTOSAVE_KEEP);

  if (keepIds.length === 0) return;

  await db
    .delete(noteRevisions)
    .where(
      and(
        eq(noteRevisions.noteId, noteId),
        eq(noteRevisions.reason, "autosave"),
        notInArray(
          noteRevisions.id,
          keepIds.map((r) => r.id),
        ),
      ),
    );
}
