import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  libraries,
  notes,
  TRASH_FOLDER_NAME,
  user,
} from "@episteme/db/schema";
import { resolveNoteSlug } from "@/lib/crud";
import { deriveLibraryName } from "@/lib/library-name";

const SEED_DIR = "public/seed";
const WELCOME_NOTE_FILE = "welcome-note.md";
const WELCOME_NOTE_TITLE = "Welcome to Episteme";

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

  // Read disk + resolve slug BEFORE the transaction so a transient I/O
  // failure aborts cleanly instead of leaving a library row without a
  // welcome note (the early-return above would then permanently wedge
  // re-tries: lib exists → no-op → user never sees the welcome note).
  const noteMdPath = path.join(process.cwd(), SEED_DIR, WELCOME_NOTE_FILE);
  const contentMd = await fs.readFile(noteMdPath, "utf8");
  const slug = await resolveNoteSlug(userId, WELCOME_NOTE_TITLE);

  // Resolve library name from the user's display name when available.
  // Anonymous users get a generated name (e.g. "anon-…") which is harmless
  // but ugly; the SidebarShell already rewrites that label to "Demo Workspace".
  const [userRow] = await db
    .select({ name: user.name, firstname: user.firstname })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const libraryName = deriveLibraryName({
    name: userRow?.name ?? null,
    firstname: userRow?.firstname ?? null,
  });

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(libraries)
        .values({ userId, name: libraryName })
        .returning();
      await tx.insert(folders).values({
        libraryId: created.id,
        userId,
        parentId: null,
        name: TRASH_FOLDER_NAME,
        isTrash: true,
      });
      await tx.insert(notes).values({
        libraryId: created.id,
        userId,
        folderPath: "",
        title: WELCOME_NOTE_TITLE,
        slug,
        contentMd,
      });
    });
  } catch (err) {
    // Concurrent seeder won the race (libraries_user_id_unique). The first
    // run owns the welcome seed; bail out without surfacing a 500 from the
    // user-create auth hook.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("libraries_user_id_unique")) return;
    throw err;
  }
}
