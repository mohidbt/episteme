import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders, libraries } from "@episteme/db/schema";
import { TRASH_FOLDER_NAME } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { libraryCreateSchema } from "@/lib/validators";
import { jsonError } from "@/lib/crud";

export async function GET(req: Request) {
  // Dual-auth: cookie session OR HMAC (for agent tools like list_libraries).
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const rows = await db
    .select()
    .from(libraries)
    .where(eq(libraries.userId, authed.userId))
    .orderBy(asc(libraries.createdAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const parsed = libraryCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const row = await db.transaction(async (tx) => {
    const [lib] = await tx
      .insert(libraries)
      .values({ userId, name: parsed.data.name })
      .returning();
    await tx.insert(folders).values({
      libraryId: lib.id,
      userId,
      parentId: null,
      name: TRASH_FOLDER_NAME,
      isTrash: true,
    });
    return lib;
  });
  return Response.json(row, { status: 201 });
}
