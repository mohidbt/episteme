import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_, noteLinks } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { referenceUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
import { getTrashFolderId, moveItemToFolder } from "@/lib/folders-server";
import { isUniqueViolation, suggestNextCitationKey } from "@/lib/references";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<any>(references_, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(res.row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = referenceUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const res = await requireOwned<any>(references_, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const { folderId, ...rest } = parsed.data;
  if (folderId !== undefined) {
    if (rest.folderPath !== undefined) {
      console.warn("references PATCH: folderPath ignored when folderId is present");
    }
    try {
      await moveItemToFolder({ kind: "reference", itemId: id, userId, targetFolderId: folderId });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (status === 404) return jsonError(404, "folder_not_found");
      throw err;
    }
  }
  const hasOtherUpdates = Object.keys(rest).length > 0;
  try {
    if (hasOtherUpdates) {
      const [row] = await db.update(references_).set(rest).where(eq(references_.id, id)).returning();
      return Response.json(row);
    }
    const [row] = await db.select().from(references_).where(eq(references_.id, id));
    return Response.json(row);
  } catch (err) {
    if (isUniqueViolation(err) && typeof rest.citationKey === "string") {
      return Response.json(
        { error: "citation_key_conflict", suggestion: suggestNextCitationKey(rest.citationKey) },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const res = await requireOwned<any>(references_, id, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");

  const trashId = await getTrashFolderId(res.row.libraryId, userId);
  if (res.row.folderId !== trashId) {
    return jsonError(400, "items must be in trash before permanent delete");
  }

  // Cascade: note_links has no FK on targetId (polymorphic). Manually wipe references before the row.
  await db.transaction(async (tx) => {
    await tx.delete(noteLinks).where(and(eq(noteLinks.targetKind, "reference"), eq(noteLinks.targetId, id)));
    await tx.delete(references_).where(eq(references_.id, id));
  });
  return new Response(null, { status: 204 });
}
