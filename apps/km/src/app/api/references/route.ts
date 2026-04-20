import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_ } from "@episteme/db/schema";
import { libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { referenceCreateSchema } from "@/lib/validators";
import { jsonError, requireOwned } from "@/lib/crud";

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  if (!libraryIdStr) return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number(libraryIdStr);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation");
  const folderPath = url.searchParams.get("folderPath");
  const conds = [eq(references_.userId, userId), eq(references_.libraryId, libraryId)];
  if (folderPath !== null) conds.push(eq(references_.folderPath, folderPath));
  const rows = await db.select().from(references_).where(and(...conds)).orderBy(asc(references_.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const parsed = referenceCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const lib = await requireOwned<any>(libraries, parsed.data.libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");
  const [row] = await db.insert(references_).values({ ...parsed.data, userId }).returning();
  return Response.json(row, { status: 201 });
}
