import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { notes, noteRevisions } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";
import { createRevisionIfNeeded } from "@/lib/notes/create-revision";

const reasonSchema = z.enum(["pre-ai-edit", "conflict-resolve"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;

  const url = new URL(req.url);
  const parsed = reasonSchema.safeParse(url.searchParams.get("reason"));
  if (!parsed.success) return jsonError(400, "validation");

  const [row] = await db
    .select({ contentMd: notes.contentMd })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
  if (!row) return jsonError(404, "not_found");

  await createRevisionIfNeeded({
    noteId: id,
    authorId: userId,
    newMd: row.contentMd ?? "",
    reason: parsed.data,
  });

  const [inserted] = await db
    .select({
      id: noteRevisions.id,
      createdAt: noteRevisions.createdAt,
      reason: noteRevisions.reason,
    })
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, id))
    .orderBy(desc(noteRevisions.createdAt), desc(noteRevisions.id))
    .limit(1);

  return NextResponse.json(inserted, { status: 201 });
}
