import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_ } from "@episteme/db/schema";

export const listReferences = cache(
  async (libraryId: number, userId: string, folderPath: string) =>
    db
      .select()
      .from(references_)
      .where(
        and(
          eq(references_.libraryId, libraryId),
          eq(references_.userId, userId),
          eq(references_.folderPath, folderPath),
        ),
      )
      .orderBy(desc(references_.createdAt)),
);

export type ReferenceRow = Awaited<ReturnType<typeof listReferences>>[number];

export const getReference = cache(async (id: string, userId: string) => {
  const rows = await db
    .select()
    .from(references_)
    .where(and(eq(references_.id, id), eq(references_.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
});
