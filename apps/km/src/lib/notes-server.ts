import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";

export const listNotes = cache(
  async (libraryId: number, userId: string) =>
    db
      .select({
        id: notes.id,
        slug: notes.slug,
        title: notes.title,
        updatedAt: notes.updatedAt,
        folderId: notes.folderId,
      })
      .from(notes)
      .where(and(eq(notes.libraryId, libraryId), eq(notes.userId, userId)))
      .orderBy(asc(notes.createdAt)),
);

export type NoteRow = Awaited<ReturnType<typeof listNotes>>[number];
