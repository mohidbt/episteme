// GSD-126 P0 — narrow helper that answers "does this user have a real
// per-user BYOK row?". Lives in its own file so the resolver tests can
// mock it without dragging the whole drizzle stack into the unit test.
//
// Why this exists: @episteme/auth/byok#getDecryptedApiKey returns the
// EPISTEME_SHARED_LLM_KEY env var when the user has no row, which would
// shadow Step 2 (managed bucket) of the resolver for every signed-in
// user. The resolver uses hasUserBYOK to know whether to even attempt
// the BYOK path.

import { db } from "@/lib/db";
import { userApiKeys } from "@episteme/db/schema";
import { and, eq } from "drizzle-orm";

export async function hasUserBYOK(userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: userApiKeys.userId })
    .from(userApiKeys)
    .where(
      and(eq(userApiKeys.userId, userId), eq(userApiKeys.providerType, "llm")),
    )
    .limit(1);
  return rows.length > 0;
}
