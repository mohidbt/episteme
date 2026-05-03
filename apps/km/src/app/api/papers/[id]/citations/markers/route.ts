import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { papers, documentReferences, documentReferenceMarkers } from "@episteme/db/schema";
import { eq } from "drizzle-orm";
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
        eq(documentReferenceMarkers.referenceId, documentReferences.id),
      )
      .where(eq(documentReferences.paperId, paperId));

    return NextResponse.json({ markers });
  } catch {
    return jsonError(500, "internal server error");
  }
}
