import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paperHighlights } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
type HighlightRow = typeof paperHighlights.$inferSelect;

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<HighlightRow>(paperHighlights, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  await db.delete(paperHighlights).where(eq(paperHighlights.id, id));
  return new Response(null, { status: 204 });
}
