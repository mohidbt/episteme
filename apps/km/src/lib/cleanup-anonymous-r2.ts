import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, papers } from "@episteme/db/schema";
import {
  storage,
  paperSourceKey,
  paperCoverKey,
  assetSourceKey,
} from "@/lib/storage";

/**
 * Delete a user's R2 objects (papers + covers + assets) before the
 * user-delete cascade fires and the rows holding the storage keys are gone.
 *
 * Used in two places:
 *   1. anonymous plugin onLinkAccount — fires when a guest signs up / signs
 *      in to an existing account, before better-auth deletes the anon row.
 *   2. /api/internal/cleanup-anon-orphans cron — sweeps stale anon sessions
 *      that were never linked (user abandoned the tab).
 *
 * Note: anon R2 content is NOT limited to seedAnonymousUser's seed PDFs.
 * Guests can also add papers via the agent tool `agentic_fetch_papers`
 * (POST /api/papers has no isAnonymous gate, and the agent dual-auth
 * bypasses cookie checks). Enumerating papers + assets covers both
 * origins uniformly.
 *
 * Best-effort: each delete is `.catch()`-ed so a missing R2 object or
 * transient error doesn't fail the calling flow; the subsequent DB
 * cascade is the source of truth for "this user is gone".
 */
export async function cleanupUserR2(userId: string): Promise<void> {
  const paperRows = await db
    .select({ id: papers.id })
    .from(papers)
    .where(eq(papers.userId, userId));
  const assetRows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.userId, userId));

  const keys: string[] = [];
  for (const p of paperRows) {
    keys.push(paperSourceKey(p.id), paperCoverKey(p.id));
  }
  for (const a of assetRows) {
    keys.push(assetSourceKey(a.id));
  }

  // Cap concurrency. A single guest deletes ~13 keys; the cron sweep can
  // call this for 200 users back-to-back. Unbounded Promise.all would peak
  // at ~2600 in-flight R2 deletes and risk throttling / timeouts.
  const CONCURRENCY = 8;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const batch = keys.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map((k) => storage.deleteObject(k).catch(() => {})),
    );
  }
}

/**
 * better-auth `onAnonymousLink` adapter — signature `(anonUserId, newUserId)`.
 * Delegates to `cleanupUserR2`.
 */
export async function cleanupAnonymousR2(
  anonUserId: string,
  _newUserId: string,
): Promise<void> {
  await cleanupUserR2(anonUserId);
}
