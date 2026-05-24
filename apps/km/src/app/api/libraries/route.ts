import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders, libraries } from "@episteme/db/schema";
import { TRASH_FOLDER_NAME } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { requireNonGuestSession } from "@/lib/auth/require-non-guest";
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
  // K9: anonymous guests get one library auto-seeded; the one-library-per-user
  // invariant means they'd 409 anyway, but reject explicitly so the error is
  // unambiguous.
  const gate = await requireNonGuestSession(req);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const body = await req.json().catch(() => null);
  const parsed = libraryCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  // One-library-per-user invariant. Reject before opening a transaction so we
  // don't have to swallow the unique-constraint error from the DB.
  const [existing] = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .limit(1);
  if (existing) {
    return jsonError(409, "library_exists", { libraryId: existing.id });
  }
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
