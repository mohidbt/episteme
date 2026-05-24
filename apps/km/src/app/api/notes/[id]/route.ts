import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { requireNonGuestAuthed } from "@/lib/auth/require-non-guest";
import { noteUpdateSchema } from "@/lib/validators";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { getTrashFolderId, moveItemToFolder } from "@/lib/folders-server";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: Ctx) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured"); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id } = await params;
  // Treat path param as either UUID or slug. Agent tools call this route with
  // both forms via the `read_note` tool (id_or_slug).
  if (UUID_RE.test(id)) {
    const res = await requireOwned<any>(notes, id, userId);
    if (!res.ok) return jsonError(res.status, res.status === 404 ? "not_found" : "forbidden");
    return Response.json(res.row);
  }
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.slug, id)))
    .limit(1);
  if (!row) return jsonError(404, "not_found");
  return Response.json(row);
}

export async function PATCH(req: Request, { params }: Ctx) {
  // Read body once so HMAC verification (when present) can be done over the
  // exact bytes; then parse the cached string.
  const rawBody = await req.text();
  // K9: anonymous guests cannot edit notes. HMAC callers (agent edit_note
  // tool) pass through.
  const gate = await requireNonGuestAuthed(req, rawBody);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const { id } = await params;
  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* leaves body=null */ }
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
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured"); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
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
