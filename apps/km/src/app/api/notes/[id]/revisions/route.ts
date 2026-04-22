import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { notes, noteRevisions } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";
import { createRevisionIfNeeded } from "@/lib/notes/create-revision";

type Ctx = { params: Promise<{ id: string }> };

async function findOwnedNote(id: string, userId: string) {
  const [row] = await db
    .select({ id: notes.id, contentMd: notes.contentMd })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
  return row;
}

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const owned = await findOwnedNote(id, userId);
  if (!owned) return jsonError(404, "not_found");
  const rows = await db
    .select({
      id: noteRevisions.id,
      createdAt: noteRevisions.createdAt,
      reason: noteRevisions.reason,
      charCount: sql<number>`length(${noteRevisions.contentMd})`,
    })
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, id))
    .orderBy(desc(noteRevisions.createdAt), desc(noteRevisions.id));
  return Response.json(rows);
}

const postBody = z
  .object({
    reason: z.enum(["manual", "pre-ai-edit", "conflict-resolve"]).optional(),
  })
  .nullable();

export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  const owned = await findOwnedNote(id, userId);
  if (!owned) return jsonError(404, "not_found");
  const raw = await req.text();
  const json = raw.length === 0 ? null : (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (json === undefined) return jsonError(400, "validation", { message: "invalid json" });
  const parsed = postBody.safeParse(json);
  if (!parsed.success)
    return jsonError(400, "validation", { issues: parsed.error.issues });
  const reason = parsed.data?.reason ?? "manual";
  const currentContentMd = owned.contentMd ?? "";
  const inserted = await createRevisionIfNeeded({
    noteId: id,
    authorId: userId,
    newMd: currentContentMd,
    reason,
  });
  if (!inserted) return jsonError(500, "revision_not_created");
  return Response.json(
    { id: inserted.id, createdAt: inserted.createdAt, reason: inserted.reason },
    { status: 201 },
  );
}
