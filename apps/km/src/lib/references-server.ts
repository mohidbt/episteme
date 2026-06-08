import { cache } from "react";
import { and, desc, eq, or, sql } from "drizzle-orm";
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

// O2: papers picker for the manual attach UI on /r/[id]. Restored from
// pre-b8b7556 (deletion was over-eager — see commit message).
export const listPapersInLibrary = cache(
  async (libraryId: number, userId: string) =>
    db
      .select({
        id: papers.id,
        title: papers.title,
        filename: papers.filename,
        year: papers.year,
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

/**
 * GSD-8 — "Already referenced" check that catches both wiring states:
 * a) a row in `references` with paper_id == this paper's id (explicit link), OR
 * b) a row in the SAME library whose CSL JSON DOI matches this paper's DOI
 *    (the dedup signal the POST /api/references endpoint uses — 409 fires on
 *    citation-key collision derived from DOI, so a DOI hit guarantees the
 *    add-as-reference flow would 409).
 *
 * Returns true if either match exists. Used to disable the "Add as reference"
 * button on cold paper-page load even when the existing reference row predates
 * the paper_id wiring (paper_id IS NULL).
 */
export const paperAlreadyReferenced = cache(
  async (
    paperId: string,
    libraryId: number | null,
    doi: string | null,
    userId: string,
  ): Promise<boolean> => {
    // Match a) explicit paper_id link (any library — usually the same one).
    // Match b) DOI hit in the same library only (refs are library-scoped).
    const doiClause =
      doi && libraryId != null
        ? and(
            eq(references_.libraryId, libraryId),
            // Postgres `jsonb ->> 'DOI'` returns text; compare case-insensitively
            // because CSL DOIs are normalised to lowercase but some imports leak
            // mixed case.
            sql`lower(${references_.cslJson} ->> 'DOI') = lower(${doi})`,
          )
        : undefined;
    const conds = [eq(references_.userId, userId)];
    const matchClause = doiClause
      ? or(eq(references_.paperId, paperId), doiClause)
      : eq(references_.paperId, paperId);
    conds.push(matchClause as never);
    const rows = await db
      .select({ id: references_.id })
      .from(references_)
      .where(and(...conds))
      .limit(1);
    return rows.length > 0;
  },
);
