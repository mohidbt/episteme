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
  path: z.string(),
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
  const path = normalizeFolderPath(parsed.data.path);

  if (path === "") return jsonError(400, "validation", { message: "cannot delete section root" });

  const libRows = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(and(eq(libraries.id, libraryId), eq(libraries.userId, userId)))
    .limit(1);
  if (libRows.length === 0) return jsonError(404, "not_found");

  const table = TABLES[section];

  const result = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(table)
      .where(
        and(
          eq(table.userId, userId),
          eq(table.libraryId, libraryId),
          or(eq(table.folderPath, path), like(table.folderPath, sql`${path} || '%'`)),
        ),
      )
      .returning({ id: table.id });
    return deleted.length;
  });

  return Response.json({ ok: true, deletedCount: result });
}
