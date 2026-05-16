import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentReferences,
  paperCitations,
  papers,
} from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

type Direction = "citing" | "cited-in";

function parseDirection(raw: string | null): Direction | null {
  if (raw === null || raw === "") return "citing";
  if (raw === "citing" || raw === "cited-in") return raw;
  return null;
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok)
    return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const url = new URL(request.url);
  const direction = parseDirection(url.searchParams.get("direction"));
  if (!direction) return jsonError(400, "invalid_direction");

  // For "citing": rows where this paper is the citer; the "other" side is cited.
  // For "cited-in": rows where this paper is the cited; the "other" side is the citer.
  //
  // Title resolution: LEFT JOIN both papers (when otherKind='paper') and
  // document_references (when otherKind='reference'), then COALESCE.
  // paper_citations.{citer,cited}_id is text; document_references.id is serial,
  // so we cast to int for the join. Papers.id is uuid; cast to text for the join.
  const isCiting = direction === "citing";

  const otherKindCol = isCiting ? paperCitations.citedKind : paperCitations.citerKind;
  const otherIdCol = isCiting ? paperCitations.citedId : paperCitations.citerId;
  const selfKindCol = isCiting ? paperCitations.citerKind : paperCitations.citedKind;
  const selfIdCol = isCiting ? paperCitations.citerId : paperCitations.citedId;

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
        // Privacy: only resolve title when the cited paper is owned by the
        // requesting user. Cross-user edges still appear in the list but
        // their title is NULL (rendered as a generic placeholder client-side).
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
    .where(and(eq(selfKindCol, "paper"), eq(selfIdCol, paperId)))
    .orderBy(asc(paperCitations.sourceMarkerIdx), asc(paperCitations.id));

  return NextResponse.json({ edges: rows });
}
