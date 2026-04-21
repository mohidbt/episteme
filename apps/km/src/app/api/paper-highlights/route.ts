import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paperHighlights, papers } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { paperHighlightCreateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type PaperRow = typeof papers.$inferSelect;

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const paperId = url.searchParams.get("paperId");
  if (!paperId) return jsonError(400, "validation", { message: "paperId required" });

  // Verify paper ownership before returning any highlights; shape matches
  // requireOwned so that 404/403 behavior is consistent with other routes.
  const owned = await requireOwned<PaperRow>(papers, paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const rows = await db
    .select()
    .from(paperHighlights)
    .where(
      and(
        eq(paperHighlights.paperId, paperId),
        eq(paperHighlights.userId, userId),
      ),
    )
    .orderBy(asc(paperHighlights.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const parsed = paperHighlightCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const owned = await requireOwned<PaperRow>(papers, parsed.data.paperId, userId);
  if (!owned.ok) return jsonError(owned.status, owned.status === 404 ? "not_found" : "forbidden");

  const [row] = await db
    .insert(paperHighlights)
    .values({
      paperId: parsed.data.paperId,
      userId,
      page: parsed.data.page,
      bbox: (parsed.data.bbox ?? null) as typeof paperHighlights.$inferInsert["bbox"],
      color: parsed.data.color ?? null,
      noteMd: parsed.data.noteMd ?? null,
    })
    .returning();
  return Response.json(row, { status: 201 });
}
