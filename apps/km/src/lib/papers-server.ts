import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";

export const listPapers = cache(
  async (libraryId: number, userId: string, folderPath: string) =>
    db
      .select()
      .from(papers)
      .where(
        and(
          eq(papers.libraryId, libraryId),
          eq(papers.userId, userId),
          eq(papers.folderPath, folderPath),
        ),
      )
      .orderBy(desc(papers.addedAt)),
);

export type PaperRow = Awaited<ReturnType<typeof listPapers>>[number];

/** Returns all papers for the library regardless of folder. Used by /papers page. */
export const listAllPapers = cache(
  async (libraryId: number, userId: string) =>
    db
      .select()
      .from(papers)
      .where(
        and(
          eq(papers.libraryId, libraryId),
          eq(papers.userId, userId),
        ),
      )
      .orderBy(desc(papers.addedAt)),
);
