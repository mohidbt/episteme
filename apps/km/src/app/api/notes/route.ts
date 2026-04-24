import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { libraries } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { noteCreateSchema } from "@/lib/validators";
import { jsonError, requireOwned, resolveNoteSlug } from "@/lib/crud";
import { resolveUnresolvedNoteLinks, createRevisionIfNeeded } from "@episteme/notes-core";

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
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

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
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
