import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_, noteLinks } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { referenceUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";
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
  try {
    const [row] = await db.update(references_).set(parsed.data).where(eq(references_.id, id)).returning();
    return Response.json(row);
  } catch (err) {
    if (isUniqueViolation(err) && typeof parsed.data.citationKey === "string") {
      return Response.json(
        { error: "citation_key_conflict", suggestion: suggestNextCitationKey(parsed.data.citationKey) },
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
  // Cascade: note_links has no FK on targetId (polymorphic). Manually wipe references before the row.
  await db.transaction(async (tx) => {
    await tx.delete(noteLinks).where(and(eq(noteLinks.targetKind, "reference"), eq(noteLinks.targetId, id)));
    await tx.delete(references_).where(eq(references_.id, id));
  });
  return new Response(null, { status: 204 });
}
