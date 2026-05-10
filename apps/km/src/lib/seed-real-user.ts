import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  libraries,
  notes,
  TRASH_FOLDER_NAME,
} from "@episteme/db/schema";
import { resolveNoteSlug } from "@/lib/crud";

const SEED_DIR = "public/seed";
const WELCOME_NOTE_FILE = "welcome-note.md";
const WELCOME_NOTE_TITLE = "Welcome to Episteme";
const REAL_USER_LIBRARY_NAME = "My Library";

/**
 * Seed minimal workspace for a freshly-created real (non-anonymous) user:
 * one library named "My Library", a Trash folder, and the welcome note.
 *
 * Idempotent: if the user already has a library, no-op. Covers both signup
 * paths (direct and signup-while-anon); the anon's demo workspace is wiped
 * by the user-delete cascade after better-auth removes the anon row.
 */
export async function seedRealUser(userId: string): Promise<void> {
  const [existing] = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .limit(1);
  if (existing) return;

  const lib = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(libraries)
      .values({ userId, name: REAL_USER_LIBRARY_NAME })
      .returning();
    await tx.insert(folders).values({
      libraryId: created.id,
      userId,
      parentId: null,
      name: TRASH_FOLDER_NAME,
      isTrash: true,
    });
    return created;
  });

  const noteMdPath = path.join(process.cwd(), SEED_DIR, WELCOME_NOTE_FILE);
  const contentMd = await fs.readFile(noteMdPath, "utf8");
  const slug = await resolveNoteSlug(userId, WELCOME_NOTE_TITLE);
  await db.insert(notes).values({
    libraryId: lib.id,
    userId,
    folderPath: "",
    title: WELCOME_NOTE_TITLE,
    slug,
    contentMd,
  });
}
