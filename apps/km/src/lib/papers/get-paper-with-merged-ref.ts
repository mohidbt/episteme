import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers, references_ } from "@episteme/db/schema";
import { mergeWithMatchedRef } from "./merge-with-matched-ref";

// GSD-32 Phase 3: load a paper and merge in CSL fields from the matched
// library reference (paper_id = papers.id). If multiple matched refs exist
// (legacy state from manual attach + auto-twin), pick the most recently
// updated. Returns the merged paper row, or null if not found.

export async function getPaperWithMergedRef(paperId: string, userId: string) {
  const paperRows = await db
    .select()
    .from(papers)
    .where(and(eq(papers.id, paperId), eq(papers.userId, userId)))
    .limit(1);
  const paper = paperRows[0];
  if (!paper) return null;

  const refRows = await db
    .select({ cslJson: references_.cslJson })
    .from(references_)
    .where(and(eq(references_.userId, userId), eq(references_.paperId, paperId)))
    .orderBy(desc(references_.updatedAt))
    .limit(1);
  const ref = refRows[0] ?? null;

  return mergeWithMatchedRef(paper, ref);
}
