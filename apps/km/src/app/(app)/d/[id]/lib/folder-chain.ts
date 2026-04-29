import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders } from "@episteme/db/schema";

export interface FolderChainEntry {
  id: string;
  name: string;
  isTrash: boolean;
}

/**
 * Resolve the chain of folders from root → leaf for a given folderId.
 * Returns [] if folderId is null. Walks `parentId` upward, then reverses.
 *
 * Hard cap of 64 levels guards against any accidental cycle.
 */
export async function getFolderChain(
  folderId: string | null,
  userId: string,
): Promise<FolderChainEntry[]> {
  if (!folderId) return [];
  const chain: FolderChainEntry[] = [];
  let cursor: string | null = folderId;
  for (let i = 0; i < 64 && cursor; i++) {
    const currentId: string = cursor;
    const rows = await db
      .select({
        id: folders.id,
        name: folders.name,
        parentId: folders.parentId,
        isTrash: folders.isTrash,
        userId: folders.userId,
      })
      .from(folders)
      .where(eq(folders.id, currentId))
      .limit(1);
    const row: {
      id: string;
      name: string;
      parentId: string | null;
      isTrash: boolean;
      userId: string;
    } | undefined = rows[0];
    if (!row || row.userId !== userId) break;
    chain.push({ id: row.id, name: row.name, isTrash: row.isTrash });
    cursor = row.parentId;
  }
  return chain.reverse();
}
