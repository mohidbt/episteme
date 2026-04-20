import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { documentSegments, documents } from "@episteme/db/schema";
import { eq, and, notInArray } from "drizzle-orm";

const EXCLUDED_KINDS = ["paragraph", "table"] as const;

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
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);

    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const segments = await db
      .select({
        id: documentSegments.id,
        documentId: documentSegments.documentId,
        page: documentSegments.page,
        kind: documentSegments.kind,
        bbox: documentSegments.bbox,
        payload: documentSegments.payload,
        orderIndex: documentSegments.orderIndex,
      })
      .from(documentSegments)
      .where(
        and(
          eq(documentSegments.documentId, documentId),
          notInArray(documentSegments.kind, [...EXCLUDED_KINDS])
        )
      );

    return NextResponse.json({ segments }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
