import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { libraryUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const libId = Number(id);
  if (!Number.isFinite(libId)) return jsonError(404, "not_found");
  const res = await requireOwned<any>(libraries, libId, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  return Response.json(res.row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const libId = Number(id);
  if (!Number.isFinite(libId)) return jsonError(404, "not_found");
  const body = await req.json().catch(() => null);
  const parsed = libraryUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const res = await requireOwned<any>(libraries, libId, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  const [row] = await db.update(libraries).set(parsed.data).where(eq(libraries.id, libId)).returning();
  return Response.json(row);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const libId = Number(id);
  if (!Number.isFinite(libId)) return jsonError(404, "not_found");
  const res = await requireOwned<any>(libraries, libId, userId);
  if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
  await db.delete(libraries).where(eq(libraries.id, libId));
  return new Response(null, { status: 204 });
}
