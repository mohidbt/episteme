import { eq, sql } from "drizzle-orm";
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
 * One-library-per-user invariant: if `newUserId` already has a library (e.g.
 * the user previously signed up, then a fresh anon session linked back into
 * that account), we cannot UPDATE the anon library's user_id directly — the
 * unique index `libraries_user_id_unique` would reject it. Instead we merge:
 * keep `newUserId`'s existing library (the survivor) and re-point all anon
 * library's child rows onto the survivor BEFORE the user_id update. The anon
 * library row is then deleted; the cascade on user delete handles cleanup.
 *
 * Note: `userPreferences.userId` and `agentConfigs.userId` are PRIMARY KEYs.
 * `UPDATE … SET user_id = newUserId` would fail if `newUserId` already had a
 * row in those tables. In the anon→new flow this is normally safe (newUser
 * was just created), but a re-link path could exist. We swallow the conflict
 * by deleting the anon row instead when the new user already has one.
 */
export async function migrateAnonymousUser(
  anonUserId: string,
  newUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Find the survivor library (oldest of newUser's existing libraries; if
    // none, the anon library will become it after the user_id update).
    const survivorRows = await tx
      .select({ id: libraries.id })
      .from(libraries)
      .where(eq(libraries.userId, newUserId))
      .orderBy(libraries.createdAt)
      .limit(1);
    const survivor = survivorRows[0];

    if (survivor) {
      // newUser already has a library; merge anon's libraries into it.
      const anonLibs = await tx
        .select({ id: libraries.id })
        .from(libraries)
        .where(eq(libraries.userId, anonUserId));

      for (const anonLib of anonLibs) {
        if (anonLib.id === survivor.id) continue;

        // Resolve uniqueness collisions before re-parenting. references has
        // (library_id, citation_key) unique; folders has (library_id,
        // parent_id, name) unique. Any other child collisions surface as a
        // raised error; we want to know if a new collision class appears.
        await tx.execute(sql`
          DELETE FROM "references" r
           WHERE r.library_id = ${anonLib.id}
             AND EXISTS (
               SELECT 1 FROM "references" s
                WHERE s.library_id = ${survivor.id}
                  AND s.citation_key = r.citation_key
             )
        `);
        await tx.execute(sql`
          UPDATE folders f
             SET name = f.name || ' (merged from anon)'
           WHERE f.library_id = ${anonLib.id}
             AND EXISTS (
               SELECT 1 FROM folders s
                WHERE s.library_id = ${survivor.id}
                  AND s.name = f.name
                  AND s.parent_id IS NOT DISTINCT FROM f.parent_id
             )
        `);

        // Re-parent child rows onto the survivor.
        await tx
          .update(folders)
          .set({ libraryId: survivor.id })
          .where(eq(folders.libraryId, anonLib.id));
        await tx
          .update(assets)
          .set({ libraryId: survivor.id })
          .where(eq(assets.libraryId, anonLib.id));
        await tx
          .update(notes)
          .set({ libraryId: survivor.id })
          .where(eq(notes.libraryId, anonLib.id));
        await tx
          .update(papers)
          .set({ libraryId: survivor.id })
          .where(eq(papers.libraryId, anonLib.id));
        await tx
          .update(papersets)
          .set({ libraryId: survivor.id })
          .where(eq(papersets.libraryId, anonLib.id));
        await tx
          .update(references_)
          .set({ libraryId: survivor.id })
          .where(eq(references_.libraryId, anonLib.id));

        // Drop the now-empty anon library.
        await tx.delete(libraries).where(eq(libraries.id, anonLib.id));
      }
    } else {
      // No conflict — the anon's library becomes newUser's library.
      await tx
        .update(libraries)
        .set({ userId: newUserId })
        .where(eq(libraries.userId, anonUserId));
    }

    // Now re-parent everything else by user_id. Skip anything that already
    // points at the survivor (already migrated above for the with-survivor
    // branch — those rows now have user_id=anonUserId still since we updated
    // by library_id, not user_id).
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

    // Singleton-per-user tables (PRIMARY KEY = userId): delete the anon row
    // if newUser already has one; otherwise re-parent.
    const existingPrefs = await tx
      .select({ userId: userPreferences.userId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, newUserId))
      .limit(1);
    if (existingPrefs[0]) {
      await tx.delete(userPreferences).where(eq(userPreferences.userId, anonUserId));
    } else {
      await tx
        .update(userPreferences)
        .set({ userId: newUserId })
        .where(eq(userPreferences.userId, anonUserId));
    }
    const existingAgentCfg = await tx
      .select({ userId: agentConfigs.userId })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, newUserId))
      .limit(1);
    if (existingAgentCfg[0]) {
      await tx.delete(agentConfigs).where(eq(agentConfigs.userId, anonUserId));
    } else {
      await tx
        .update(agentConfigs)
        .set({ userId: newUserId })
        .where(eq(agentConfigs.userId, anonUserId));
    }

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
