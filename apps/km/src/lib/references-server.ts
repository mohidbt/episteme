import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, references_ } from "@episteme/db/schema";

/** Returns all references for the library regardless of folder. Used by /references page. */
export const listAllReferences = cache(
  async (libraryId: number, userId: string) =>
    db
      .select()
      .from(references_)
      .where(
        and(
          eq(references_.libraryId, libraryId),
          eq(references_.userId, userId),
        ),
      )
      .orderBy(desc(references_.createdAt)),
);

export const listReferences = cache(
  async (libraryId: number, userId: string, folderPath: string) =>
    db
      .select()
      .from(references_)
      .where(
        and(
          eq(references_.libraryId, libraryId),
          eq(references_.userId, userId),
          eq(references_.folderPath, folderPath),
        ),
      )
      .orderBy(desc(references_.createdAt)),
);

export type ReferenceRow = Awaited<ReturnType<typeof listReferences>>[number];

export const getReference = cache(async (id: string, userId: string) => {
  const rows = await db
    .select()
    .from(references_)
    .where(and(eq(references_.id, id), eq(references_.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
});

export const listPapersInLibrary = cache(
  async (libraryId: number, userId: string) =>
    db
      .select({
        id: papers.id,
        title: papers.title,
        filename: papers.filename,
        year: papers.year,
        folderPath: papers.folderPath,
      })
      .from(papers)
      .where(and(eq(papers.libraryId, libraryId), eq(papers.userId, userId)))
      .orderBy(desc(papers.addedAt)),
);

export type PaperPickerRow = Awaited<ReturnType<typeof listPapersInLibrary>>[number];

export const getReferencesForPaper = cache(
  async (paperId: string, userId: string) =>
    db
      .select()
      .from(references_)
      .where(and(eq(references_.paperId, paperId), eq(references_.userId, userId)))
      .orderBy(desc(references_.createdAt)),
);
