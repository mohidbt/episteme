import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { userHighlights } from "@episteme/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; highlightId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, highlightId } = await params;
  const documentId = parseInt(id, 10);
  const hId = parseInt(highlightId, 10);
  if (isNaN(documentId) || isNaN(hId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = (await request.json()) as { comment?: string | null };
  const patch: { comment?: string | null } = {};
  if (body.comment === null || typeof body.comment === "string") {
    patch.comment = body.comment ?? null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 422 });
  }

  try {
    const [updated] = await db
      .update(userHighlights)
      .set(patch)
      .where(
        and(
          eq(userHighlights.id, hId),
          eq(userHighlights.documentId, documentId),
          eq(userHighlights.userId, session.user.id)
        )
      )
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ highlight: updated });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; highlightId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, highlightId } = await params;
  const documentId = parseInt(id, 10);
  const hId = parseInt(highlightId, 10);
  if (isNaN(documentId) || isNaN(hId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const [deleted] = await db
      .delete(userHighlights)
      .where(
        and(
          eq(userHighlights.id, hId),
          eq(userHighlights.documentId, documentId),
          eq(userHighlights.userId, session.user.id)
        )
      )
      .returning({ id: userHighlights.id });

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
