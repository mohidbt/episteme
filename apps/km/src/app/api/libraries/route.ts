import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { libraryCreateSchema } from "@/lib/validators";
import { jsonError } from "@/lib/crud";

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const rows = await db
    .select()
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .orderBy(asc(libraries.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const parsed = libraryCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const [row] = await db.insert(libraries).values({ userId, name: parsed.data.name }).returning();
  return Response.json(row, { status: 201 });
}
