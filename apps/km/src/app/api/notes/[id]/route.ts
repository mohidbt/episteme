import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { noteUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { getTrashFolderId, moveItemToFolder } from "@/lib/folders-server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<any>(notes, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(res.row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = noteUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const res = await requireOwned<any>(notes, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const { folderId, ...rest } = parsed.data;
  if (folderId !== undefined) {
    if (rest.folderPath !== undefined) {
      console.warn("notes PATCH: folderPath ignored when folderId is present");
    }
    try {
      await moveItemToFolder({ kind: "note", itemId: id, userId, targetFolderId: folderId });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (status === 404) return jsonError(404, "folder_not_found");
      throw err;
    }
  }
  const updates: Record<string, unknown> = { ...rest };
  if (rest.title && rest.title !== (res.row as any).title) {
    updates.slug = await resolveNoteSlug(userId, rest.title, id);
  }
  const hasOtherUpdates = Object.keys(updates).length > 0;
  if (hasOtherUpdates) {
    const [row] = await db.update(notes).set(updates).where(eq(notes.id, id)).returning();
    return Response.json(row);
  }
  const [row] = await db.select().from(notes).where(eq(notes.id, id));
  return Response.json(row);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<any>(notes, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  const trashId = await getTrashFolderId(res.row.libraryId, userId);
  if (res.row.folderId !== trashId) {
    return jsonError(400, "items must be in trash before permanent delete");
  }

  await db.delete(notes).where(eq(notes.id, id));
  return new Response(null, { status: 204 });
}
