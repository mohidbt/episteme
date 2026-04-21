import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { noteTags, notes } from "@episteme/db/schema";

export async function listTagsWithCounts(
  userId: string,
): Promise<Array<{ tag: string; count: number }>> {
  const rows = await db
    .select({
      tag: noteTags.tag,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(noteTags)
    .innerJoin(notes, eq(notes.id, noteTags.noteId))
    .where(eq(notes.userId, userId))
    .groupBy(noteTags.tag)
    .orderBy(asc(noteTags.tag));
  return rows;
}

export async function listNotesByTag(
  userId: string,
  tag: string,
): Promise<Array<{ id: string; title: string; slug: string }>> {
  const rows = await db
    .select({ id: notes.id, title: notes.title, slug: notes.slug })
    .from(noteTags)
    .innerJoin(notes, eq(notes.id, noteTags.noteId))
    .where(and(eq(notes.userId, userId), eq(noteTags.tag, tag.toLowerCase())))
    .orderBy(asc(notes.title));
  return rows;
}
