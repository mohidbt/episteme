import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders } from "@episteme/db/schema";

export interface DriveChainEntry {
  id: string;
  name: string;
}

/**
 * Resolve a `/drive/<seg>/<seg>/…` path against the folder tree for a single
 * library/user. Each segment matches `folders.name` under the running parent.
 * Returns `null` if any segment fails to resolve (so callers can `notFound()`).
 * Percent-encoded segments are decoded before comparison; malformed escapes
 * also return `null`.
 */
export async function resolveDrivePath(
  libraryId: number,
  userId: string,
  path: string[],
): Promise<DriveChainEntry[] | null> {
  const chain: DriveChainEntry[] = [];
  let parent: string | null = null;
  for (const seg of path) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return null;
    }
    const [row] = await db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(
        and(
          eq(folders.libraryId, libraryId),
          eq(folders.userId, userId),
          parent == null ? isNull(folders.parentId) : eq(folders.parentId, parent),
          eq(folders.name, decoded),
        ),
      )
      .limit(1);
    if (!row) return null;
    chain.push(row);
    parent = row.id;
  }
  return chain;
}
