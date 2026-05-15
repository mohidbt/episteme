import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, noteRevisions } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";
import { saveNoteMd, NoteOverLimitError } from "@/lib/notes/save-note-md";

type Ctx = { params: Promise<{ id: string; rev: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
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
  try {
    await saveNoteMd(id, row.contentMd, userId, "manual");
  } catch (err) {
    if (err instanceof NoteOverLimitError) {
      return NextResponse.json(
        {
          error: "over_limit",
          usedBytes: err.usedBytes,
          limitBytes: err.limitBytes,
        },
        { status: 413 },
      );
    }
    throw err;
  }
  return new NextResponse(null, { status: 204 });
}
