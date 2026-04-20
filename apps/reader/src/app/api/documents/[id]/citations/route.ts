import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documentReferences, documents, keptCitations } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const documentId = parseInt(id, 10);
  if (isNaN(documentId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    // Verify ownership
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const citations = await db
      .select({
        id: documentReferences.id,
        documentId: documentReferences.documentId,
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
          eq(keptCitations.userId, session.user.id)
        )
      )
      .where(eq(documentReferences.documentId, documentId));

    return NextResponse.json({ citations });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
