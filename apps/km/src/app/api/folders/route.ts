import { NextResponse } from "next/server";
import { z } from "zod";
import { createFolder } from "@/lib/folders-server";
import { validateFolderName, normalizeFolderName } from "@/lib/folders";
import { db } from "@/lib/db";
import { libraries, folders } from "@episteme/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/auth";

const Body = z.object({
  libraryId: z.number().int().positive(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { libraryId, parentId, name } = parsed.data;

  const normalized = normalizeFolderName(name);
  const nameErr = validateFolderName(normalized);
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 });

  const [lib] = await db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
    .limit(1);
  if (!lib) return NextResponse.json({ error: "library not found" }, { status: 404 });

  // app-level duplicate check: postgres unique index treats NULLs as distinct,
  // so root-level siblings (parentId = NULL) aren't caught by the index alone.
  const parentCond = parentId == null ? isNull(folders.parentId) : eq(folders.parentId, parentId);
  const [dup] = await db.select({ id: folders.id }).from(folders)
    .where(and(
      eq(folders.libraryId, libraryId),
      eq(folders.userId, userId),
      parentCond,
      eq(folders.name, normalized),
    )).limit(1);
  if (dup) return NextResponse.json({ error: "duplicate name" }, { status: 409 });

  try {
    const out = await createFolder({
      libraryId, userId, parentId, name: normalized,
    });
    return NextResponse.json(out, { status: 201 });
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number };
    if (err.code === "23505") return NextResponse.json({ error: "duplicate name" }, { status: 409 });
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
