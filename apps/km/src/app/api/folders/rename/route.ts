import { and, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { libraries, notes, papers, references_ } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";
import { normalizeFolderPath } from "@/lib/tree";

const bodySchema = z.object({
  libraryId: z.number().int(),
  section: z.enum(["papers", "references", "notes"]),
  oldPath: z.string(),
  newPath: z.string(),
});

const TABLES = {
  papers,
  references: references_,
  notes,
} as const;

export async function POST(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const { libraryId, section } = parsed.data;
  const oldPath = normalizeFolderPath(parsed.data.oldPath);
  const newPath = normalizeFolderPath(parsed.data.newPath);

  if (oldPath === "") return jsonError(400, "validation", { message: "cannot rename section root" });
  if (newPath === "") return jsonError(400, "validation", { message: "newPath cannot be empty" });
  if (oldPath === newPath) return jsonError(400, "validation", { message: "oldPath === newPath" });
  if (newPath.startsWith(oldPath)) return jsonError(400, "validation", { message: "cycle: newPath inside oldPath" });

  const libRows = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
    .limit(1);
  if (libRows.length === 0) return jsonError(404, "not_found");

  const table = TABLES[section];

  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(table)
      .set({
        folderPath: sql`${newPath} || SUBSTRING(${table.folderPath} FROM ${oldPath.length + 1}::int)`,
      })
      .where(
        and(
          eq(table.userId, userId),
          eq(table.libraryId, libraryId),
          or(eq(table.folderPath, oldPath), like(table.folderPath, `${oldPath}%`)),
        ),
      )
      .returning({ id: table.id });
    return updated.length;
  });

  return Response.json({ ok: true, updatedCount: result });
}
