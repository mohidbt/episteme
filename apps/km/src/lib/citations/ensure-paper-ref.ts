import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_ } from "@episteme/db/schema";
import { deriveCitationKey, type CslItem } from "@/lib/csl";

// GSD-32 Phase 4: every paper gets a hidden ref-twin so users can later edit
// the ref's CSL fields (abstract, container-title, etc.) and the paper picks
// them up via the Phase 3 read-time merge. Hidden from UX surfaces because
// Phase 1 filters refs where `paper_id IS NOT NULL`.
//
// Idempotent: skip if a ref already exists for this paperId, or (in the same
// library) one whose CSL DOI matches the paper's DOI. In the DOI-only-match
// case we ALSO bind the ref's paperId so future identity checks short-circuit
// to the explicit pointer.

export interface PaperForRefTwin {
  id: string;
  libraryId: number;
  userId: string;
  title: string | null;
  authors: string[] | null;
  year: number | null;
  doi: string | null;
}

export type EnsureResult = {
  created: boolean;
  refId: string;
};

export function buildCslJsonForPaper(paper: PaperForRefTwin): CslItem {
  const csl: CslItem = {
    id: paper.id,
    type: "article-journal",
    title: paper.title ?? `Paper ${paper.id.slice(0, 8)}`,
  };
  if (paper.authors && paper.authors.length > 0) {
    csl.author = paper.authors.map((a) => ({ literal: a }));
  }
  if (paper.year != null) {
    csl.issued = { "date-parts": [[paper.year]] };
  }
  if (paper.doi) {
    csl.DOI = paper.doi;
  }
  return csl;
}

export async function ensurePaperRef(paper: PaperForRefTwin): Promise<EnsureResult> {
  // 1. Direct paperId hit — already wired.
  const existing = (await db
    .select({ id: references_.id, paperId: references_.paperId })
    .from(references_)
    .where(
      and(eq(references_.userId, paper.userId), eq(references_.paperId, paper.id)),
    )
    .limit(1)) as Array<{ id: string; paperId: string | null }>;
  if (existing.length > 0) {
    return { created: false, refId: existing[0].id };
  }

  // 2. DOI hit in same library — bind paperId so identity checks short-circuit.
  if (paper.doi) {
    const doiHit = (await db
      .select({ id: references_.id, paperId: references_.paperId })
      .from(references_)
      .where(
        and(
          eq(references_.userId, paper.userId),
          eq(references_.libraryId, paper.libraryId),
          sql`lower(${references_.cslJson}->>'DOI') = lower(${paper.doi})`,
        ),
      )
      .limit(1)) as Array<{ id: string; paperId: string | null }>;
    if (doiHit.length > 0) {
      const hit = doiHit[0];
      if (hit.paperId == null) {
        await db
          .update(references_)
          .set({ paperId: paper.id })
          .where(eq(references_.id, hit.id));
      }
      return { created: false, refId: hit.id };
    }
  }

  // 3. Insert a new hidden ref-twin.
  const csl = buildCslJsonForPaper(paper);
  const citationKey = deriveCitationKey(csl);
  const [row] = await db
    .insert(references_)
    .values({
      libraryId: paper.libraryId,
      userId: paper.userId,
      folderPath: "",
      folderId: null,
      citationKey,
      cslJson: csl,
      paperId: paper.id,
    })
    .returning({ id: references_.id });
  return { created: true, refId: row.id };
}
