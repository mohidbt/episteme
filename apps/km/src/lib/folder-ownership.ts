import { and, eq } from "drizzle-orm";
import { folders } from "@episteme/db/schema";
import { db } from "@/lib/db";

export async function isOwnedFolderInLibrary(
  folderId: string,
  libraryId: number,
  userId: string,
): Promise<boolean> {
  const [folder] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.id, folderId),
        eq(folders.libraryId, libraryId),
        eq(folders.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(folder);
}
