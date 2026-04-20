import { NextRequest, NextResponse } from "next/server";
import { auth } from "@episteme/auth/server";
import { db } from "@episteme/db";
import { aiHighlightRuns, documents, userHighlights } from "@episteme/db/schema";
import { and, eq, desc, count, inArray } from "drizzle-orm";
import { isStaleRect } from "@/lib/highlight-rects";

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
          eq(aiHighlightRuns.documentId, documentId),
          eq(aiHighlightRuns.userId, session.user.id)
        )
      )
      .groupBy(
        aiHighlightRuns.id,
        aiHighlightRuns.instruction,
        aiHighlightRuns.status,
        aiHighlightRuns.summary,
        aiHighlightRuns.createdAt,
        aiHighlightRuns.completedAt
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
            inArray(userHighlights.layerId, runIds)
          )
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
    console.error("GET /auto-highlight/runs failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
