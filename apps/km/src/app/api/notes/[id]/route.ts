import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { noteUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<any>(notes, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(res.row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = noteUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const res = await requireOwned<any>(notes, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.title && parsed.data.title !== (res.row as any).title) {
    updates.slug = await resolveNoteSlug(userId, parsed.data.title, id);
  }
  const [row] = await db.update(notes).set(updates).where(eq(notes.id, id)).returning();
  return Response.json(row);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<any>(notes, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  await db.delete(notes).where(eq(notes.id, id));
  return new Response(null, { status: 204 });
}
