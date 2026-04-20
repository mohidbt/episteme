import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documentReferenceMarkers, documentReferences, documents } from "@episteme/db/schema";
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

    const markers = await db
      .select({
        id: documentReferenceMarkers.id,
        referenceId: documentReferenceMarkers.referenceId,
        markerIndex: documentReferences.markerIndex,
        pageNumber: documentReferenceMarkers.pageNumber,
        x0: documentReferenceMarkers.x0,
        y0: documentReferenceMarkers.y0,
        x1: documentReferenceMarkers.x1,
        y1: documentReferenceMarkers.y1,
      })
      .from(documentReferenceMarkers)
      .innerJoin(
        documentReferences,
        eq(documentReferenceMarkers.referenceId, documentReferences.id)
      )
      .where(eq(documentReferences.documentId, documentId));

    return NextResponse.json({ markers });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
