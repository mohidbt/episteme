import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { papers, documentReferences, keptCitations } from "@episteme/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function GET(request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const citations = await db
      .select({
        id: documentReferences.id,
        paperId: documentReferences.paperId,
        markerText: documentReferences.markerText,
        markerIndex: documentReferences.markerIndex,
        rawText: documentReferences.rawText,
        title: documentReferences.title,
        authors: documentReferences.authors,
        year: documentReferences.year,
        doi: documentReferences.doi,
        url: documentReferences.url,
        semanticScholarId: documentReferences.semanticScholarId,
        abstract: documentReferences.abstract,
        venue: documentReferences.venue,
        citationCount: documentReferences.citationCount,
        pageNumber: documentReferences.pageNumber,
        createdAt: documentReferences.createdAt,
        keptId: keptCitations.id,
        libraryReferenceId: keptCitations.libraryReferenceId,
      })
      .from(documentReferences)
      .leftJoin(
        keptCitations,
        and(
          eq(keptCitations.documentReferenceId, documentReferences.id),
          eq(keptCitations.userId, userId),
        ),
      )
      .where(eq(documentReferences.paperId, paperId))
      .orderBy(asc(documentReferences.markerIndex), asc(documentReferences.rawText));

    return NextResponse.json({ citations });
  } catch {
    return jsonError(500, "internal server error");
  }
}
