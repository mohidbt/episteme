import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documents, documentReferences, libraryReferences, keptCitations } from "@episteme/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { buildLibraryReference } from "@/lib/citations/library-sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; refId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, refId } = await params;
  const documentId = parseInt(id, 10);
  const documentReferenceId = parseInt(refId, 10);
  if (isNaN(documentId) || isNaN(documentReferenceId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  try {
    // Verify document ownership
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Verify + fetch document_reference
    const [ref] = await db
      .select()
      .from(documentReferences)
      .where(
        and(
          eq(documentReferences.id, documentReferenceId),
          eq(documentReferences.documentId, documentId)
        )
      )
      .limit(1);

    if (!ref) {
      return NextResponse.json({ error: "Citation not found" }, { status: 404 });
    }

    // Find or create library_reference.
    // With a DOI we can use ON CONFLICT against the partial unique index
    // (userId, doi) WHERE doi IS NOT NULL — race-free under concurrent saves.
    // Without a DOI we insert a new row (dedup isn't meaningful without a DOI).
    let libraryReferenceId: number;
    const payload = buildLibraryReference(session.user.id, ref);

    if (ref.doi) {
      const [row] = await db
        .insert(libraryReferences)
        .values(payload)
        .onConflictDoUpdate({
          target: [libraryReferences.userId, libraryReferences.doi],
          targetWhere: sql`${libraryReferences.doi} IS NOT NULL`,
          set: {
            // Refresh metadata in case the citation was re-enriched since the
            // original save. updatedAt is bumped automatically by $onUpdate.
            title: payload.title,
            authors: payload.authors,
            year: payload.year,
            url: payload.url,
            semanticScholarId: payload.semanticScholarId,
            abstract: payload.abstract,
            venue: payload.venue,
            citationCount: payload.citationCount,
          },
        })
        .returning({ id: libraryReferences.id });
      libraryReferenceId = row.id;
    } else {
      const [row] = await db
        .insert(libraryReferences)
        .values(payload)
        .returning({ id: libraryReferences.id });
      libraryReferenceId = row.id;
    }

    // Upsert kept_citations against the (userId, documentReferenceId) unique
    // constraint — race-free and sets libraryReferenceId whether this is the
    // first save or an upgrade from a prior Keep (libraryReferenceId: null).
    const [kept] = await db
      .insert(keptCitations)
      .values({
        userId: session.user.id,
        documentReferenceId,
        libraryReferenceId,
      })
      .onConflictDoUpdate({
        target: [keptCitations.userId, keptCitations.documentReferenceId],
        set: { libraryReferenceId },
      })
      .returning({ id: keptCitations.id });

    return NextResponse.json({ libraryReferenceId, keptId: kept.id });
  } catch (err) {
    console.error("[citations/save] failed for document", documentId, "ref", documentReferenceId, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
