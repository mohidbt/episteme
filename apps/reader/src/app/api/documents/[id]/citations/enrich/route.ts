import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documents, documentReferences } from "@episteme/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { enrichReferences, type EnrichmentResult } from "@/lib/citations/semantic-scholar";
import { getUserS2Key } from "@episteme/auth/byok";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (isNaN(documentId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  try {
    // Ownership check
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch all document references that haven't been enriched yet
    const refs = await db
      .select({
        id: documentReferences.id,
        title: documentReferences.title,
        doi: documentReferences.doi,
      })
      .from(documentReferences)
      .where(
        and(
          eq(documentReferences.documentId, documentId),
          isNull(documentReferences.semanticScholarId)
        )
      );

    const total = refs.length;

    if (total === 0) {
      return NextResponse.json({ enriched: 0, total: 0 });
    }

    // Enrich references via Semantic Scholar two-pass pipeline
    const s2Key = await getUserS2Key(session.user.id);
    const results = await enrichReferences(refs, { apiKey: s2Key ?? undefined });

    type ResolvedResult = EnrichmentResult & { metadata: NonNullable<EnrichmentResult["metadata"]> };
    const enrichedResults = results.filter((r): r is ResolvedResult => r.metadata !== null);

    // Update each matched reference in parallel (each targets a distinct id)
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
          .where(eq(documentReferences.id, refId))
      )
    );

    return NextResponse.json({ enriched: enrichedResults.length, total });
  } catch (err) {
    console.error("[citations/enrich] failed for document", documentId, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
