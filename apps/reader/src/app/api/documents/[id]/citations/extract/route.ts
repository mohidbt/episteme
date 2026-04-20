import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documents, documentReferences, documentReferenceMarkers } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { extractCitations } from "@/lib/citations/parser";
import { extractAnnotationMarkers } from "@/lib/citations/annotation-extractor";
import { authorStringToJson } from "@/lib/citations/author-utils";

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
      .select({ id: documents.id, filePath: documents.filePath })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // --- Attempt annotation-based extraction first ---
    let annRefs: Awaited<ReturnType<typeof extractAnnotationMarkers>>["references"] = [];
    let annMarkers: Awaited<ReturnType<typeof extractAnnotationMarkers>>["markers"] = [];
    let usedAnnotations = false;

    try {
      const annResult = await extractAnnotationMarkers(doc.filePath);
      annRefs = annResult.references;
      annMarkers = annResult.markers;
      // Require at least 3 resolved references to trust annotation extraction.
      // A single spurious internal link on a bracket-style PDF must not suppress
      // the text-regex fallback that would have found all [n] references.
      usedAnnotations = annRefs.length >= 3;
    } catch (annErr) {
      console.warn(
        "[citations/extract] annotation extraction failed, falling back to text-regex",
        annErr
      );
    }

    // --- Fallback: text-regex extraction when no annotation markers ---
    let inserted: typeof documentReferences.$inferSelect[] = [];
    let markersInserted = 0;

    if (usedAnnotations) {
      // Full replace semantics
      await db
        .delete(documentReferences)
        .where(eq(documentReferences.documentId, documentId));

      inserted = await db
        .insert(documentReferences)
        .values(
          annRefs.map((ref) => ({
            documentId,
            markerText: `[${ref.markerIndex}]`,
            markerIndex: ref.markerIndex,
            rawText: ref.rawText ?? null,
            title: ref.title ?? null,
            authors: authorStringToJson(ref.authors),
            year: ref.year ?? null,
            doi: ref.doi ?? null,
            url: ref.url ?? null,
            semanticScholarId: null,
            abstract: null,
            venue: null,
            citationCount: null,
            pageNumber: null,
          }))
        )
        .returning();

      // Build markerIndex → referenceId map from inserted rows
      const refIdByMarkerIndex = new Map<number, number>(
        inserted.map((r) => [r.markerIndex, r.id])
      );

      // Insert marker rects
      const markerRows = annMarkers
        .map((m) => {
          const referenceId = refIdByMarkerIndex.get(m.markerIndex);
          if (referenceId == null) return null;
          return {
            referenceId,
            pageNumber: m.pageNumber,
            x0: m.x0,
            y0: m.y0,
            x1: m.x1,
            y1: m.y1,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (markerRows.length > 0) {
        await db.insert(documentReferenceMarkers).values(markerRows);
        markersInserted = markerRows.length;
      }
    } else {
      // Text-regex fallback
      const pages = await extractPdfPages(doc.filePath);
      const { markers, references } = extractCitations(pages);

      const markerPageMap = new Map<number, number>(
        markers.map((m) => [m.markerIndex, m.pageNumber])
      );

      if (references.length > 0) {
        await db
          .delete(documentReferences)
          .where(eq(documentReferences.documentId, documentId));

        inserted = await db
          .insert(documentReferences)
          .values(
            references.map((ref) => ({
              documentId,
              markerText: `[${ref.markerIndex}]`,
              markerIndex: ref.markerIndex,
              rawText: ref.rawText ?? null,
              title: ref.title ?? null,
              authors: authorStringToJson(ref.authors),
              year: ref.year ?? null,
              doi: ref.doi ?? null,
              url: ref.url ?? null,
              semanticScholarId: null,
              abstract: null,
              venue: null,
              citationCount: null,
              pageNumber: markerPageMap.get(ref.markerIndex) ?? null,
            }))
          )
          .returning();
      }
    }

    return NextResponse.json(
      {
        references: inserted,
        stats: {
          markersFound: usedAnnotations ? annMarkers.length : 0,
          referencesExtracted: inserted.length,
          referencesInserted: inserted.length,
          markersInserted,
          extractionMethod: usedAnnotations ? "annotations" : "text-regex",
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[citations/extract] failed for document", documentId, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
