import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { papers, documentReferences } from "@episteme/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/auth";
import { getUserS2Key } from "@episteme/auth/byok";
import { jsonError, requireOwned } from "@/lib/crud";
import { enrichReferences, type EnrichmentResult } from "@/lib/citations/semantic-scholar";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function POST(request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const refs = await db
      .select({
        id: documentReferences.id,
        title: documentReferences.title,
        doi: documentReferences.doi,
      })
      .from(documentReferences)
      .where(
        and(
          eq(documentReferences.paperId, paperId),
          isNull(documentReferences.semanticScholarId),
        ),
      );

    const total = refs.length;
    if (total === 0) {
      return NextResponse.json({ enriched: 0, total: 0 });
    }

    const s2Key = await getUserS2Key(userId);
    const results = await enrichReferences(refs, { apiKey: s2Key ?? undefined });

    type ResolvedResult = EnrichmentResult & { metadata: NonNullable<EnrichmentResult["metadata"]> };
    const enrichedResults = results.filter((r): r is ResolvedResult => r.metadata !== null);

    await Promise.all(
      enrichedResults.map(({ refId, metadata }) =>
        db
          .update(documentReferences)
          .set({
            semanticScholarId: metadata.paperId,
            title: metadata.title,
            authors: metadata.authors.length > 0 ? metadata.authors : null,
            year: metadata.year != null ? String(metadata.year) : null,
            doi: metadata.externalIds?.DOI ?? null,
            url: metadata.paperId
              ? `https://www.semanticscholar.org/paper/${metadata.paperId}`
              : null,
            abstract: metadata.abstract,
            venue: metadata.venue,
            citationCount: metadata.citationCount,
            influentialCitationCount: metadata.influentialCitationCount,
            openAccessPdfUrl: metadata.openAccessPdfUrl,
            tldrText: metadata.tldr,
            externalIds: metadata.externalIds,
            bibtex: metadata.bibtex,
          })
          .where(eq(documentReferences.id, refId)),
      ),
    );

    return NextResponse.json({ enriched: enrichedResults.length, total });
  } catch (err) {
    console.error("[citations/enrich] failed for paper", paperId, err);
    return jsonError(500, "internal server error");
  }
}
