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
 * Delete the anon user's R2 objects before the user-delete cascade wipes
 * the rows that hold the storage keys. Without this, every guest session
 * leaks its seeded paper PDFs + cover PNGs into R2 (guests can't upload,
 * but seedAnonymousUser uploads ~6 seed PDFs + covers per session).
 *
 * Called from better-auth anonymous plugin's onLinkAccount hook. Best-effort:
 * a missing R2 object is fine; we don't roll back the link on cleanup
 * failure since the DB cascade still happens.
 */
export async function cleanupAnonymousR2(
  anonUserId: string,
  _newUserId: string,
): Promise<void> {
  const paperRows = await db
    .select({ id: papers.id })
    .from(papers)
    .where(eq(papers.userId, anonUserId));
  const assetRows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.userId, anonUserId));

  const keys: string[] = [];
  for (const p of paperRows) {
    keys.push(paperSourceKey(p.id), paperCoverKey(p.id));
  }
  for (const a of assetRows) {
    keys.push(assetSourceKey(a.id));
  }

  await Promise.all(
    keys.map((k) => storage.deleteObject(k).catch(() => {})),
  );
}
