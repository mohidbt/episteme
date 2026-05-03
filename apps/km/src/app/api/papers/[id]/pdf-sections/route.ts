import { NextRequest } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentSegments, papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

const EXCLUDED_KINDS = ["paragraph", "table"] as const;

type Ctx = { params: Promise<{ id: string }> };
type PaperRow = typeof papers.$inferSelect;

export async function GET(_request: NextRequest, { params }: Ctx) {
  const userId = await getUserIdFromRequest(_request);
  if (!userId) return jsonError(401, "unauthorized");

  const { id } = await params;
  const owned = await requireOwned<PaperRow>(papers, id, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  try {
    const segments = await db
      .select({
        id: documentSegments.id,
        paperId: documentSegments.paperId,
        page: documentSegments.page,
        kind: documentSegments.kind,
        bbox: documentSegments.bbox,
        payload: documentSegments.payload,
        orderIndex: documentSegments.orderIndex,
      })
      .from(documentSegments)
      .where(
        and(
          eq(documentSegments.paperId, id),
          notInArray(documentSegments.kind, [...EXCLUDED_KINDS]),
        ),
      );

    return Response.json(
      { segments },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch {
    return jsonError(500, "internal server error");
  }
}
