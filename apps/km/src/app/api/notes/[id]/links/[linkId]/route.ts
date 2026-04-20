import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { noteLinks } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError, requireOwned } from "@/lib/crud";

type Ctx = { params: Promise<{ id: string; linkId: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id, linkId } = await params;
  const owner = await requireOwned<any>(notes, id, userId);
  if (!owner.ok) return jsonError(owner.status, owner.status === 404 ? "not_found" : "forbidden");
  const existing = await db
    .select({ id: noteLinks.id })
    .from(noteLinks)
    .where(and(eq(noteLinks.id, linkId), eq(noteLinks.sourceNoteId, id)))
    .limit(1);
  if (existing.length === 0) return jsonError(404, "not_found");
  await db.delete(noteLinks).where(eq(noteLinks.id, linkId));
  return new Response(null, { status: 204 });
}
