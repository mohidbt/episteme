import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userPreferences } from "@episteme/db/schema";

export type FontPref = "sans" | "serif" | "mono";

export interface UserPreferences {
  font: FontPref;
  ruledLines: boolean;
}

const DEFAULTS: UserPreferences = { font: "sans", ruledLines: false };

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (!row) return DEFAULTS;
  return { font: row.font as FontPref, ruledLines: row.ruledLines };
}
