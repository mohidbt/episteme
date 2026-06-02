import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@/lib/db";
import { aiHighlightRuns, paperHighlights, papers, userHighlights } from "@episteme/db/schema";
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
    // Three writers can produce rows under a single runId:
    //   1. ai_highlight_runs   — auto-highlight pipeline + chat-agent path
    //   2. user_highlights     — layer_id = runId, no FK so cascade manually
    //   3. paper_highlights    — chat-agent `create_highlights` tool inserts
    //                            geometry rows here, NOT into user_highlights
    // Chat-agent runs always also create the ai_highlight_runs parent row
    // (see services/agents/routers/chat.py `ensure_run_id`), but some
    // historical or partial runs may only have paper_highlights rows. Treat
    // the run as "found" if any of the three tables yielded a delete.
    const result = await db.transaction(async (tx) => {
      const userDel = await tx
        .delete(userHighlights)
        .where(
          and(
            eq(userHighlights.userId, session.user.id),
            eq(userHighlights.layerId, runId),
          ),
        );
      const paperDel = await tx
        .delete(paperHighlights)
        .where(
          and(
            eq(paperHighlights.userId, session.user.id),
            eq(paperHighlights.paperId, paperId),
            eq(paperHighlights.runId, runId),
          ),
        );
      const runDel = await tx
        .delete(aiHighlightRuns)
        .where(
          and(
            eq(aiHighlightRuns.id, runId),
            eq(aiHighlightRuns.paperId, paperId),
            eq(aiHighlightRuns.userId, session.user.id),
          ),
        );
      const userCount = userDel.rowCount ?? 0;
      const paperCount = paperDel.rowCount ?? 0;
      const runCount = runDel.rowCount ?? 0;
      return userCount + paperCount + runCount;
    });

    if (result === 0) return jsonError(404, "not_found");
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError(500, "internal server error");
  }
}
