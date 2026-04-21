import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userPreferences } from "@episteme/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/crud";
import { preferencesPatchSchema } from "@/lib/validators";
import { getUserPreferences } from "@/lib/preferences-server";

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const prefs = await getUserPreferences(userId);
  return Response.json(prefs);
}

export async function PATCH(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return jsonError(401, "unauthorized");
  const body = await req.json().catch(() => null);
  const parsed = preferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", { issues: parsed.error.issues });
  }
  const patch = parsed.data;

  const insertValues: typeof userPreferences.$inferInsert = {
    userId,
    ...(patch.font !== undefined ? { font: patch.font } : {}),
    ...(patch.ruledLines !== undefined ? { ruledLines: patch.ruledLines } : {}),
  };

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.font !== undefined) setValues.font = patch.font;
  if (patch.ruledLines !== undefined) setValues.ruledLines = patch.ruledLines;

  await db
    .insert(userPreferences)
    .values(insertValues)
    .onConflictDoUpdate({ target: userPreferences.userId, set: setValues });

  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return Response.json({ font: row.font, ruledLines: row.ruledLines });
}
