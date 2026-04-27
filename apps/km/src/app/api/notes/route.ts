import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { libraries } from "@episteme/db/schema";
import { getAuthedUserId } from "@/lib/internal-auth";
import { noteCreateSchema } from "@/lib/validators";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { resolveUnresolvedNoteLinks, createRevisionIfNeeded } from "@episteme/notes-core";

export async function GET(req: Request) {
  const userId = await getAuthedUserId(req);
  if (!userId) return jsonError(401, "unauthorized");
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  if (!libraryIdStr) return jsonError(400, "validation", { message: "libraryId required" });
  const libraryId = Number(libraryIdStr);
  if (!Number.isFinite(libraryId)) return jsonError(400, "validation");
  const folderPath = url.searchParams.get("folderPath");
  const conds = [eq(notes.userId, userId), eq(notes.libraryId, libraryId)];
  if (folderPath !== null) conds.push(eq(notes.folderPath, folderPath));
  const rows = await db.select().from(notes).where(and(...conds)).orderBy(asc(notes.createdAt));
  return Response.json(rows);
}

/**
 * Resolve the user's default (lowest-id) library. Used for HMAC-authed
 * agent-tool calls where the body may omit `libraryId`.
 */
async function resolveDefaultLibraryId(userId: string): Promise<number | null> {
  const rows = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .orderBy(asc(libraries.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const userId = await getAuthedUserId(req, rawBody);
  if (!userId) return jsonError(401, "unauthorized");
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(rawBody); } catch { /* leaves body=null */ }
  // Agent tools (HMAC path) often omit `libraryId`. Resolve user's default
  // library on the server in that case. Per Phase 1.3b decision (notebookId is
  // ignored silently — column doesn't exist on the schema yet).
  if (body && typeof body === "object" && body.libraryId == null) {
    const defaultLibraryId = await resolveDefaultLibraryId(userId);
    if (defaultLibraryId == null) {
      return jsonError(400, "no_library", {
        message: "user has no library; create one before creating notes",
      });
    }
    body.libraryId = defaultLibraryId;
  }
  if (body && typeof body === "object" && "notebookId" in body) {
    // notebookId is not in the schema yet; ignore silently for forward compat.
    delete (body as Record<string, unknown>).notebookId;
  }
  const parsed = noteCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const lib = await requireOwned<any>(libraries, parsed.data.libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");
  const slug = await resolveNoteSlug(userId, parsed.data.title);
  const [row] = await db
    .insert(notes)
    .values({ ...parsed.data, userId, slug })
    .returning();
  // Retro-resolve any previously-unresolved [[title]] note-links whose raw
  // identifier now matches this new note. Scoped to note-kind only; paper
  // and reference retro-resolution belongs to their own create flows.
  await resolveUnresolvedNoteLinks(row.id, row.title, userId);
  await createRevisionIfNeeded({
    noteId: row.id,
    authorId: userId,
    newMd: row.contentMd ?? "",
    reason: "manual",
  });
  return Response.json(row, { status: 201 });
}
