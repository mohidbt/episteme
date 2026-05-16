import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentReferences,
  paperCitations,
  papers,
} from "@episteme/db/schema";

// D7.4 — for a given documentReferences row id, return the two adjacent lists:
//   citedIn → rows where cited_kind='reference' AND cited_id=refId  (who cites THIS ref)
//   citing  → rows where citer_kind='reference' AND citer_id=refId  (what THIS ref cites)
//
// Title resolution mirrors the D3 edges route: LEFT JOIN papers gated by
// userId so cross-user paper titles return NULL (privacy), and LEFT JOIN
// document_references for ref-on-ref edges.

export interface ReferenceEdge {
  id: number;
  otherKind: "paper" | "reference";
  otherId: string;
  title: string | null;
  markerIdx: number | null;
}

export interface ReferenceEdges {
  citedIn: ReferenceEdge[];
  citing: ReferenceEdge[];
}

async function queryEdges(
  refId: number,
  userId: string,
  direction: "citedIn" | "citing",
): Promise<ReferenceEdge[]> {
  const refIdText = String(refId);
  const isCitedIn = direction === "citedIn";
  const otherKindCol = isCitedIn ? paperCitations.citerKind : paperCitations.citedKind;
  const otherIdCol = isCitedIn ? paperCitations.citerId : paperCitations.citedId;
  const selfKindCol = isCitedIn ? paperCitations.citedKind : paperCitations.citerKind;
  const selfIdCol = isCitedIn ? paperCitations.citedId : paperCitations.citerId;

  const rows = await db
    .select({
      id: paperCitations.id,
      otherKind: otherKindCol,
      otherId: otherIdCol,
      title: sql<string | null>`COALESCE(${papers.title}, ${documentReferences.title})`,
      markerIdx: paperCitations.sourceMarkerIdx,
    })
    .from(paperCitations)
    .leftJoin(
      papers,
      and(
        eq(otherKindCol, "paper"),
        eq(sql`${papers.id}::text`, otherIdCol),
        eq(papers.userId, userId),
      ),
    )
    .leftJoin(
      documentReferences,
      and(
        eq(otherKindCol, "reference"),
        eq(sql`${documentReferences.id}::text`, otherIdCol),
      ),
    )
    .where(and(eq(selfKindCol, "reference"), eq(selfIdCol, refIdText)))
    .orderBy(asc(paperCitations.sourceMarkerIdx), asc(paperCitations.id));

  return rows as ReferenceEdge[];
}

export async function getReferenceEdges(
  refId: number,
  userId: string,
): Promise<ReferenceEdges> {
  const [citedIn, citing] = await Promise.all([
    queryEdges(refId, userId, "citedIn"),
    queryEdges(refId, userId, "citing"),
  ]);
  return { citedIn, citing };
}
