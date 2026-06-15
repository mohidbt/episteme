import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, noteRevisions } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { jsonError } from "@/lib/crud";

type Ctx = { params: Promise<{ id: string; rev: string }> };

export async function GET(req: Request, { params }: Ctx) {
  // GSD-101 — dual-auth so the agent's `diff_revision` tool can fetch
  // a revision body over HMAC. Cookie path is unchanged for UI.
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return jsonError(500, "internal auth misconfigured");
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const { id, rev } = await params;
  const [owned] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
  if (!owned) return jsonError(404, "not_found");
  const [row] = await db
    .select({ contentMd: noteRevisions.contentMd })
    .from(noteRevisions)
    .where(and(eq(noteRevisions.id, rev), eq(noteRevisions.noteId, id)));
  if (!row) return jsonError(404, "not_found");
  return Response.json({ contentMd: row.contentMd });
}
