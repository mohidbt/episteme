import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { paperCitations, papers } from "@episteme/db/schema";

// G2/Bug-2c: list of papers that cite a given reference (uuid).
// Reads paper_citations where cited_kind='reference' AND cited_id=referenceId
// AND citer_kind='paper'. Joins to papers gated by userId for cross-user
// isolation (rows where the citer paper belongs to another user are dropped).

export interface ReferenceCitedInRow {
  edgeId: number;
  paperId: string;
  title: string | null;
  markerIdx: number | null;
}

export async function getReferenceCitedIn(
  referenceId: string,
  userId: string,
): Promise<ReferenceCitedInRow[]> {
  const rows = await db
    .select({
      edgeId: paperCitations.id,
      paperId: papers.id,
      title: papers.title,
      markerIdx: paperCitations.sourceMarkerIdx,
    })
    .from(paperCitations)
    .innerJoin(
      papers,
      and(
        eq(sql`${papers.id}::text`, paperCitations.citerId),
        eq(papers.userId, userId),
      ),
    )
    .where(
      and(
        eq(paperCitations.citerKind, "paper"),
        eq(paperCitations.citedKind, "reference"),
        eq(paperCitations.citedId, referenceId),
      ),
    )
    .orderBy(asc(paperCitations.sourceMarkerIdx), asc(paperCitations.id));

  return rows as ReferenceCitedInRow[];
}
