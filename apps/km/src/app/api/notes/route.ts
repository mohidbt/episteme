import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { libraries } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { requireNonGuestAuthed } from "@/lib/auth/require-non-guest";
import { noteCreateSchema } from "@/lib/validators";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { resolveUnresolvedNoteLinks, createRevisionIfNeeded } from "@episteme/notes-core";
import { assertWithinLibraryLimit } from "@/lib/library-usage";

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

export async function GET(req: Request) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) { if (e instanceof MissingInternalSecretError) return misconfiguredResponse(); throw e; }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const url = new URL(req.url);
  const libraryIdStr = url.searchParams.get("libraryId");
  let libraryId: number;
  if (libraryIdStr) {
    libraryId = Number(libraryIdStr);
    if (!Number.isFinite(libraryId)) return jsonError(400, "validation");
  } else if (authed.viaHmac) {
    // HMAC-authed agent tool calls (e.g. list_notes) omit libraryId.
    const defaultId = await resolveDefaultLibraryId(userId);
    if (defaultId == null) return jsonError(400, "no_library", { message: "user has no library" });
    libraryId = defaultId;
  } else {
    return jsonError(400, "validation", { message: "libraryId required" });
  }
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
  // K9: anonymous guests cannot create notes via the API; HMAC callers
  // (agent tools) pass through.
  const gate = await requireNonGuestAuthed(req, rawBody);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const authed = { userId, viaHmac: gate.viaHmac };
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(rawBody); } catch { /* leaves body=null */ }
  // Agent tools (HMAC path) often omit `libraryId`. Resolve user's default
  // library on the server only for HMAC-authed requests; cookie-authed users
  // with a missing libraryId still get the original 400 validation error.
  if (
    authed.viaHmac &&
    body &&
    typeof body === "object" &&
    body.libraryId == null
  ) {
    const defaultLibraryId = await resolveDefaultLibraryId(userId);
    if (defaultLibraryId == null) {
      return jsonError(400, "no_library", {
        message: "user has no library; create one before creating notes",
      });
    }
    body.libraryId = defaultLibraryId;
  }
  // notebookId is not in the schema yet; strip silently for forward compat
  // (deliberate — applies to both auth paths so clients can future-proof).
  if (body && typeof body === "object" && "notebookId" in body) {
    delete (body as Record<string, unknown>).notebookId;
  }
  const parsed = noteCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });
  const lib = await requireOwned<any>(libraries, parsed.data.libraryId, userId);
  if (!lib.ok) return jsonError(lib.status, lib.status === 404 ? "not_found" : "forbidden");
  // Byte length of the markdown body — matches the migration backfill rule
  // (octet_length(content_md)). Empty body → 0 bytes counted toward the cap.
  const contentMd = (parsed.data as { contentMd?: string }).contentMd ?? "";
  const sizeBytes = Buffer.byteLength(contentMd, "utf8");
  const cap = await assertWithinLibraryLimit(parsed.data.libraryId, sizeBytes);
  if (!cap.ok) {
    return jsonError(413, "over_limit", {
      usedBytes: cap.usedBytes,
      limitBytes: cap.limitBytes,
    });
  }
  const slug = await resolveNoteSlug(userId, parsed.data.title);
  const [row] = await db
    .insert(notes)
    .values({ ...parsed.data, userId, slug, sizeBytes })
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
