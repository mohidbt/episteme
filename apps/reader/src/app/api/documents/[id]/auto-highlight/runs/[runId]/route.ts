import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { aiHighlightRuns, documents, userHighlights } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, runId } = await params;
  const documentId = parseInt(id, 10);
  if (isNaN(documentId) || !UUID_RE.test(runId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, session.user.id)))
      .limit(1);
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // layer_id on user_highlights has no FK to ai_highlight_runs, so the
    // cascade must be done manually. Run both deletes in a single tx.
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: aiHighlightRuns.id })
        .from(aiHighlightRuns)
        .where(
          and(
            eq(aiHighlightRuns.id, runId),
            eq(aiHighlightRuns.documentId, documentId),
            eq(aiHighlightRuns.userId, session.user.id)
          )
        )
        .limit(1);
      if (!run) return null;

      await tx
        .delete(userHighlights)
        .where(
          and(
            eq(userHighlights.userId, session.user.id),
            eq(userHighlights.layerId, runId)
          )
        );
      await tx.delete(aiHighlightRuns).where(eq(aiHighlightRuns.id, runId));
      return run.id;
    });

    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
