import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  libraries,
  notes,
  papers,
  references_,
  TRASH_FOLDER_NAME,
} from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";
import { resolveNoteSlug } from "@/lib/crud";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";

const SEED_DIR = "public/seed";
const WELCOME_NOTE_FILE = "welcome-note.md";
const WELCOME_NOTE_TITLE = "Welcome to Episteme";
const SEED_PAPER_FILE = "2005.11401.pdf";
const SEED_PAPER_TITLE =
  "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks";
const SEED_PAPER_DOI = "10.48550/arXiv.2005.11401";
const SEED_REFERENCE_CSL_FILE = "alphafold.csl.json";

/**
 * Seed app-level demo content for a freshly-created anonymous user. Idempotent:
 * if all four seed rows (library, note, paper, reference) exist, no-op.
 * Otherwise wipe any partial state for this user and re-seed from scratch — a
 * prior failed run (e.g. MinIO down, fs read error) leaves a half-seeded user
 * that must be made whole on retry.
 */
export async function seedAnonymousUser(userId: string): Promise<void> {
  // Idempotency gate: only skip if all four seed rows are present. A partial
  // state (e.g. library inserted but paper insert threw) must be redone.
  const [libRow] = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .limit(1);
  const [noteRow] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(eq(notes.userId, userId))
    .limit(1);
  const [paperRow] = await db
    .select({ id: papers.id })
    .from(papers)
    .where(eq(papers.userId, userId))
    .limit(1);
  const [refRow] = await db
    .select({ id: references_.id })
    .from(references_)
    .where(eq(references_.userId, userId))
    .limit(1);
  if (libRow && noteRow && paperRow && refRow) return;

  // Partial state exists: drop everything for this user and re-seed. Deleting
  // libraries cascades to folders/notes/papers/references_ (all FK'd to
  // libraries.id with onDelete: cascade).
  if (libRow || noteRow || paperRow || refRow) {
    await db.delete(libraries).where(eq(libraries.userId, userId));
  }

  const lib = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(libraries)
      .values({ userId, name: "My Library" })
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

  const pdfPath = path.join(process.cwd(), SEED_DIR, SEED_PAPER_FILE);
  const pdfBuf = await fs.readFile(pdfPath);
  const [paper] = await db
    .insert(papers)
    .values({
      libraryId: lib.id,
      userId,
      folderPath: "",
      folderId: null,
      filename: SEED_PAPER_FILE,
      title: SEED_PAPER_TITLE,
      doi: SEED_PAPER_DOI,
    })
    .returning();
  await storage.uploadObject(
    paperSourceKey(paper.id),
    pdfBuf,
    "application/pdf",
  );

  const cslPath = path.join(process.cwd(), SEED_DIR, SEED_REFERENCE_CSL_FILE);
  const cslRaw = JSON.parse(await fs.readFile(cslPath, "utf8")) as CslItem;
  const cslJson = validateCslJson(cslRaw);
  const citationKey = deriveCitationKey(cslJson);
  await db.insert(references_).values({
    libraryId: lib.id,
    userId,
    folderPath: "",
    citationKey,
    cslJson,
    paperId: null,
  });
}
