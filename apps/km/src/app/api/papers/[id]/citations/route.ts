import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { papers, documentReferences, keptCitations } from "@episteme/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";
import { jsonError, requireOwned } from "@/lib/crud";
import { enrichRefsWithPaperMatchAndEdges } from "@/lib/citations/enrich-refs";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function GET(request: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(request); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

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

    // D7.4: per-ref enrichment — matchedPaperId + Cited-in/Citing counts.
    // Best-effort: enrichment failures fall back to raw refs (with null
    // enrichment fields) so the refs panel stays functional if pg_trgm or
    // paper_citations relation are missing in this env.
    let enriched;
    try {
      enriched = await enrichRefsWithPaperMatchAndEdges(citations, userId);
    } catch (err) {
      console.error("[citations] enrichment failed for paper", paperId, err);
      enriched = citations.map((c) => ({
        ...c,
        matchedPaperId: null,
        citedInCount: 0,
        citingCount: 0,
      }));
    }
    return NextResponse.json({ citations: enriched });
  } catch (err) {
    console.error("[citations] GET failed for paper", paperId, err);
    return jsonError(500, "internal server error");
  }
}
