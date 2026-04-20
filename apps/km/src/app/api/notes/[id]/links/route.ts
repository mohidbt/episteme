import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { noteLinks } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { noteLinkCreateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const owner = await requireOwned<any>(notes, id, userId);
  if (!owner.ok) return jsonError(owner.status, owner.status === 404 ? "not_found" : "forbidden");
  const rows = await db
    .select()
    .from(noteLinks)
    .where(eq(noteLinks.sourceNoteId, id))
    .orderBy(asc(noteLinks.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request, { params }: Ctx) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const owner = await requireOwned<any>(notes, id, userId);
  if (!owner.ok) return jsonError(owner.status, owner.status === 404 ? "not_found" : "forbidden");
  const body = await req.json().catch(() => null);
  const bodyWithSource = { ...(body ?? {}), sourceNoteId: id };
  const parsed = noteLinkCreateSchema.safeParse(bodyWithSource);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const [row] = await db.insert(noteLinks).values(parsed.data).returning();
  return Response.json(row, { status: 201 });
}
