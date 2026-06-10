import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, ne } from "drizzle-orm";
import { renameFolder } from "@/lib/folders-server";
import { validateFolderName, normalizeFolderName } from "@/lib/folders";
import { db } from "@/lib/db";
import { folders } from "@episteme/db/schema";
import {
  getAuthedUserId,
  MissingInternalSecretError,
} from "@/lib/internal-auth";

const Body = z.object({ name: z.string().min(1).max(200) });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError)
      return NextResponse.json({ error: "internal auth misconfigured" }, { status: 500 });
    throw e;
  }
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = authed.userId;

  const { id } = await params;
  let json: unknown = null;
  try { json = JSON.parse(rawBody); } catch { /* leave null */ }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const normalized = normalizeFolderName(parsed.data.name);
  const nameErr = validateFolderName(normalized);
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });

  // app-level duplicate check: pg unique index treats NULL parent_id as distinct,
  // so root-level sibling collisions aren't caught by the index alone.
  const [subject] = await db.select({
    libraryId: folders.libraryId,
    parentId: folders.parentId,
  }).from(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId)))
    .limit(1);
  if (subject) {
    const parentCond = subject.parentId == null
      ? isNull(folders.parentId)
      : eq(folders.parentId, subject.parentId);
    const [dup] = await db.select({ id: folders.id }).from(folders)
      .where(and(
        eq(folders.libraryId, subject.libraryId),
        eq(folders.userId, userId),
        parentCond,
        eq(folders.name, normalized),
        ne(folders.id, id),
      )).limit(1);
    if (dup) return NextResponse.json({ error: "duplicate name" }, { status: 409 });
  }

  try {
    await renameFolder({ folderId: id, userId, newName: normalized });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.code === "23505") return NextResponse.json({ error: "duplicate name" }, { status: 409 });
    return NextResponse.json({ error: err.message ?? "error" }, { status: err.status ?? 500 });
  }
}
