import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentConfigs,
  agentConversations,
  agentMemories,
  assets,
  folders,
  libraries,
  notes,
  paperHighlights,
  papers,
  papersets,
  references_,
  userPreferences,
} from "@episteme/db/schema";

/**
 * Re-parents per-user data from `anonUserId` → `newUserId` inside a single
 * transaction. Invoked from better-auth's anonymous plugin `onLinkAccount`
 * hook when an anon session signs up. The anonymous plugin then deletes the
 * anon user row; cascades are safe because no FK still points at it.
 *
 * Note: `userPreferences.userId` and `agentConfigs.userId` are PRIMARY KEYs.
 * The `UPDATE … SET user_id = newUserId` would fail if `newUserId` already
 * had a row in those tables — but in this flow `newUser` was just created,
 * so no row exists yet. Safe.
 */
export async function migrateAnonymousUser(
  anonUserId: string,
  newUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(libraries)
      .set({ userId: newUserId })
      .where(eq(libraries.userId, anonUserId));
    await tx
      .update(folders)
      .set({ userId: newUserId })
      .where(eq(folders.userId, anonUserId));
    await tx
      .update(notes)
      .set({ userId: newUserId })
      .where(eq(notes.userId, anonUserId));
    await tx
      .update(papers)
      .set({ userId: newUserId })
      .where(eq(papers.userId, anonUserId));
    await tx
      .update(references_)
      .set({ userId: newUserId })
      .where(eq(references_.userId, anonUserId));
    await tx
      .update(papersets)
      .set({ userId: newUserId })
      .where(eq(papersets.userId, anonUserId));
    await tx
      .update(paperHighlights)
      .set({ userId: newUserId })
      .where(eq(paperHighlights.userId, anonUserId));
    await tx
      .update(assets)
      .set({ userId: newUserId })
      .where(eq(assets.userId, anonUserId));
    await tx
      .update(userPreferences)
      .set({ userId: newUserId })
      .where(eq(userPreferences.userId, anonUserId));
    await tx
      .update(agentConfigs)
      .set({ userId: newUserId })
      .where(eq(agentConfigs.userId, anonUserId));
    await tx
      .update(agentConversations)
      .set({ userId: newUserId })
      .where(eq(agentConversations.userId, anonUserId));
    await tx
      .update(agentMemories)
      .set({ userId: newUserId })
      .where(eq(agentMemories.userId, anonUserId));
  });
}
