import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@/lib/db";
import { aiHighlightRuns, papers, userHighlights } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string; runId: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return jsonError(401, "unauthorized");

  const { id: paperId, runId } = await params;
  if (!UUID_RE.test(runId)) return jsonError(400, "invalid_id");

  const owned = await requireOwned<PaperRow>(papers, paperId, session.user.id);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    // layer_id on user_highlights has no FK to ai_highlight_runs, so the
    // cascade must be done manually. Run both deletes in a single tx.
    const result = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: aiHighlightRuns.id })
        .from(aiHighlightRuns)
        .where(
          and(
            eq(aiHighlightRuns.id, runId),
            eq(aiHighlightRuns.paperId, paperId),
            eq(aiHighlightRuns.userId, session.user.id),
          ),
        )
        .limit(1);
      if (!run) return null;

      await tx
        .delete(userHighlights)
        .where(
          and(
            eq(userHighlights.userId, session.user.id),
            eq(userHighlights.layerId, runId),
          ),
        );
      await tx.delete(aiHighlightRuns).where(eq(aiHighlightRuns.id, runId));
      return run.id;
    });

    if (!result) return jsonError(404, "not_found");
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError(500, "internal server error");
  }
}
