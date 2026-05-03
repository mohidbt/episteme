import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@/lib/db";
import { aiHighlightRuns, papers, userHighlights } from "@episteme/db/schema";
import { and, eq, desc, count, inArray } from "drizzle-orm";
import { jsonError, requireOwned } from "@/lib/crud";
import { isStaleRect } from "@/lib/highlight-rects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return jsonError(401, "unauthorized");

  const { id: paperId } = await params;

  const owned = await requireOwned<PaperRow>(papers, paperId, session.user.id);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const rows = await db
      .select({
        id: aiHighlightRuns.id,
        instruction: aiHighlightRuns.instruction,
        status: aiHighlightRuns.status,
        summary: aiHighlightRuns.summary,
        createdAt: aiHighlightRuns.createdAt,
        completedAt: aiHighlightRuns.completedAt,
        highlightCount: count(userHighlights.id),
      })
      .from(aiHighlightRuns)
      .leftJoin(userHighlights, eq(userHighlights.layerId, aiHighlightRuns.id))
      .where(
        and(
          eq(aiHighlightRuns.paperId, paperId),
          eq(aiHighlightRuns.userId, session.user.id),
        ),
      )
      .groupBy(
        aiHighlightRuns.id,
        aiHighlightRuns.instruction,
        aiHighlightRuns.status,
        aiHighlightRuns.summary,
        aiHighlightRuns.createdAt,
        aiHighlightRuns.completedAt,
      )
      .orderBy(desc(aiHighlightRuns.createdAt));

    // Compute `hasStaleRects` per run by scanning stored rects JSONB. Cheap
    // enough server-side (one extra query scoped to this user's runs); avoids
    // shipping every rect blob to the client.
    const runIds = rows.map((r) => r.id);
    const staleByRun = new Map<string, boolean>();
    if (runIds.length > 0) {
      const rectRows = await db
        .select({
          layerId: userHighlights.layerId,
          rects: userHighlights.rects,
        })
        .from(userHighlights)
        .where(
          and(
            eq(userHighlights.userId, session.user.id),
            inArray(userHighlights.layerId, runIds),
          ),
        );
      for (const h of rectRows) {
        if (!h.layerId) continue;
        if (staleByRun.get(h.layerId)) continue;
        const rects = Array.isArray(h.rects) ? (h.rects as unknown[]) : [];
        if (rects.some((r) => isStaleRect(r as Record<string, unknown>))) {
          staleByRun.set(h.layerId, true);
        }
      }
    }
    const enriched = rows.map((r) => ({
      ...r,
      hasStaleRects: staleByRun.get(r.id) === true,
    }));

    return NextResponse.json({ runs: enriched });
  } catch (err) {
    console.error("GET /papers/[id]/auto-highlight/runs failed:", err);
    return jsonError(500, "internal server error");
  }
}
