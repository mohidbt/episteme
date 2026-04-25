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
import { fetchCrossRef as fetchCrossRefReal } from "@/lib/crossref";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";

const SEED_DIR = "public/seed";
const WELCOME_NOTE_FILE = "welcome-note.md";
const WELCOME_NOTE_TITLE = "Welcome to Episteme";
const SEED_PAPER_FILE = "2005.11401.pdf";
const SEED_PAPER_TITLE =
  "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks";
const SEED_PAPER_DOI = "10.48550/arXiv.2005.11401";
const SEED_REFERENCE_DOI = "10.1038/s41586-021-03819-2";

export interface SeedDeps {
  /** Test seam — defaults to the real CrossRef fetcher. */
  fetchCrossRef?: (doi: string) => Promise<CslItem | null>;
}

/**
 * Seed app-level demo content for a freshly-created anonymous user. Idempotent:
 * a user with an existing library is a no-op (defensive, since the create hook
 * should fire exactly once).
 */
export async function seedAnonymousUser(
  userId: string,
  deps: SeedDeps = {},
): Promise<void> {
  const fetchCrossRef = deps.fetchCrossRef ?? fetchCrossRefReal;

  // Idempotency gate.
  const existing = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(eq(libraries.userId, userId))
    .limit(1);
  if (existing.length > 0) return;

  // Library + TRASH folder, mirroring POST /api/libraries.
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

  // Welcome note.
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

  // Seed paper: insert row, upload PDF to MinIO at paperSourceKey().
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

  // Seed reference via CrossRef DOI lookup.
  const fetched = await fetchCrossRef(SEED_REFERENCE_DOI);
  if (fetched) {
    const cslJson = validateCslJson(fetched);
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
}
