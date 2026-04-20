import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries } from "@episteme/db/schema";

export const getDefaultLibrary = cache(async (userId: string) => {
  const rows = await db
    .select({ id: libraries.id, name: libraries.name })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .orderBy(asc(libraries.id))
    .limit(1);
  return rows[0] ?? null;
});
