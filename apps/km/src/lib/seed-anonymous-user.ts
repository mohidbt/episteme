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
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { resolveNoteSlug } from "@/lib/crud";
import { deriveCitationKey, validateCslJson, type CslItem } from "@/lib/csl";
import { extractCover } from "@/lib/pdf-extract";

const SEED_DIR = "public/seed";
const WELCOME_NOTE_FILE = "welcome-note.md";
const WELCOME_NOTE_TITLE = "Welcome to Episteme";
const SEED_PAPER_FILE = "2005.11401.pdf";
const SEED_PAPER_TITLE =
  "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks";
const SEED_PAPER_DOI = "10.48550/arXiv.2005.11401";
const SEED_PAPER_AUTHORS = [
  "Patrick Lewis",
  "Ethan Perez",
  "Aleksandra Piktus",
  "Fabio Petroni",
  "Vladimir Karpukhin",
  "Naman Goyal",
  "Heinrich Küttler",
  "Mike Lewis",
  "Wen-tau Yih",
  "Tim Rocktäschel",
  "Sebastian Riedel",
  "Douwe Kiela",
];
const SEED_PAPER_YEAR = 2020;

const SEED_REFERENCES = [
  "alphafold.csl.json",
  "attention.csl.json",
  "bert.csl.json",
  "gpt3.csl.json",
  "diffusion.csl.json",
];

const READING_LIST_FOLDER = "Reading List";
const FOUNDATIONS_FOLDER = "Foundations";

/**
 * Seed app-level demo content for a freshly-created anonymous user. Idempotent:
 * if all four seed kinds (library, note, paper, reference) exist, no-op.
 * Otherwise wipe any partial state for this user and re-seed from scratch — a
 * prior failed run (e.g. MinIO down, fs read error) leaves a half-seeded user
 * that must be made whole on retry.
 */
export async function seedAnonymousUser(userId: string): Promise<void> {
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

  if (libRow || noteRow || paperRow || refRow) {
    await db.delete(libraries).where(eq(libraries.userId, userId));
  }

  const { lib, foundationsFolder } = await db.transaction(async (tx) => {
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
    const [readingList] = await tx
      .insert(folders)
      .values({
        libraryId: created.id,
        userId,
        parentId: null,
        name: READING_LIST_FOLDER,
      })
      .returning();
    const [foundations] = await tx
      .insert(folders)
      .values({
        libraryId: created.id,
        userId,
        parentId: readingList.id,
        name: FOUNDATIONS_FOLDER,
      })
      .returning();
    return { lib: created, foundationsFolder: foundations };
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
      authors: SEED_PAPER_AUTHORS,
      year: SEED_PAPER_YEAR,
    })
    .returning();
  await storage.uploadObject(
    paperSourceKey(paper.id),
    pdfBuf,
    "application/pdf",
  );

  // Cover failure must NOT fail the whole seed — same policy as finalize route.
  try {
    const cover = await extractCover(new Uint8Array(pdfBuf));
    await storage.uploadObject(paperCoverKey(paper.id), cover, "image/png");
  } catch (err) {
    console.warn(`seed: cover extraction failed for paper ${paper.id}`, err);
  }

  for (let i = 0; i < SEED_REFERENCES.length; i++) {
    const cslPath = path.join(process.cwd(), SEED_DIR, SEED_REFERENCES[i]);
    const cslRaw = JSON.parse(await fs.readFile(cslPath, "utf8")) as CslItem;
    const cslJson = validateCslJson(cslRaw);
    const citationKey = deriveCitationKey(cslJson);
    // First reference (AlphaFold) at library root; the rest live in the nested
    // Reading List/Foundations folder so the demo shows nested-folder usage.
    const inFoundations = i > 0;
    await db.insert(references_).values({
      libraryId: lib.id,
      userId,
      folderPath: inFoundations
        ? `${READING_LIST_FOLDER}/${FOUNDATIONS_FOLDER}`
        : "",
      folderId: inFoundations ? foundationsFolder.id : null,
      citationKey,
      cslJson,
      paperId: null,
    });
  }
}
