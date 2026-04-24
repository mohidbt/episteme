import { db } from "../src/client";
import {
  folders,
  libraries,
  papers,
  notes,
  references_,
  TRASH_FOLDER_NAME,
} from "../src/schema";
import { and, eq, isNull } from "drizzle-orm";

async function backfill() {
  const libs = await db
    .select({ id: libraries.id, userId: libraries.userId })
    .from(libraries);

  for (const lib of libs) {
    // 1. Seed trash folder if not present.
    const existingTrash = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.libraryId, lib.id), eq(folders.isTrash, true)))
      .limit(1);
    if (existingTrash.length === 0) {
      // Guard: if a non-trash folder already owns the "Trash" name at root,
      // refuse rather than crash on the unique index. Admin must rename it.
      const collision = await db
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.libraryId, lib.id),
            isNull(folders.parentId),
            eq(folders.name, TRASH_FOLDER_NAME),
          ),
        )
        .limit(1);
      if (collision.length > 0) {
        throw new Error(
          `library ${lib.id}: a non-trash folder named "${TRASH_FOLDER_NAME}" already exists at root. Rename it before running the backfill.`,
        );
      }
      await db.insert(folders).values({
        libraryId: lib.id,
        userId: lib.userId,
        parentId: null,
        name: TRASH_FOLDER_NAME,
        isTrash: true,
      });
    }

    // 2. Collect distinct non-empty folder_path values from all three tables.
    const paths = new Set<string>();

    const paperPaths = await db
      .selectDistinct({ p: papers.folderPath })
      .from(papers)
      .where(eq(papers.libraryId, lib.id));
    for (const r of paperPaths) if (r.p && r.p.length > 0) paths.add(r.p);

    const notePaths = await db
      .selectDistinct({ p: notes.folderPath })
      .from(notes)
      .where(eq(notes.libraryId, lib.id));
    for (const r of notePaths) if (r.p && r.p.length > 0) paths.add(r.p);

    const refPaths = await db
      .selectDistinct({ p: references_.folderPath })
      .from(references_)
      .where(eq(references_.libraryId, lib.id));
    for (const r of refPaths) if (r.p && r.p.length > 0) paths.add(r.p);

    // 3. Upsert folder chains per distinct path.
    const cache = new Map<string, string>();
    const getOrCreate = async (
      parentId: string | null,
      name: string,
      userId: string,
    ): Promise<string> => {
      const key = `${parentId ?? "ROOT"}::${name}`;
      if (cache.has(key)) return cache.get(key)!;
      const existing = await db
        .select({ id: folders.id })
        .from(folders)
        .where(
          and(
            eq(folders.libraryId, lib.id),
            parentId == null
              ? isNull(folders.parentId)
              : eq(folders.parentId, parentId),
            eq(folders.name, name),
            eq(folders.isTrash, false),
          ),
        )
        .limit(1);
      if (existing[0]) {
        cache.set(key, existing[0].id);
        return existing[0].id;
      }
      const [inserted] = await db
        .insert(folders)
        .values({
          libraryId: lib.id,
          userId,
          parentId,
          name,
        })
        .returning({ id: folders.id });
      cache.set(key, inserted.id);
      return inserted.id;
    };

    const pathToDeepId = new Map<string, string>();
    for (const p of paths) {
      const segs = p.split("/").filter(Boolean);
      let parent: string | null = null;
      for (const seg of segs) parent = await getOrCreate(parent, seg, lib.userId);
      if (parent) pathToDeepId.set(p, parent);
    }

    // 4. Set folder_id on item rows whose folder_id is still null.
    for (const [path, deepId] of pathToDeepId) {
      await db
        .update(papers)
        .set({ folderId: deepId })
        .where(
          and(
            eq(papers.libraryId, lib.id),
            eq(papers.folderPath, path),
            isNull(papers.folderId),
          ),
        );
      await db
        .update(notes)
        .set({ folderId: deepId })
        .where(
          and(
            eq(notes.libraryId, lib.id),
            eq(notes.folderPath, path),
            isNull(notes.folderId),
          ),
        );
      await db
        .update(references_)
        .set({ folderId: deepId })
        .where(
          and(
            eq(references_.libraryId, lib.id),
            eq(references_.folderPath, path),
            isNull(references_.folderId),
          ),
        );
    }
  }

  console.log("backfill complete.");
}

backfill().catch((e) => {
  console.error(e);
  process.exit(1);
});
