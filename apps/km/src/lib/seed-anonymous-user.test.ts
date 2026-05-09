import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  libraries,
  notes,
  papers,
  papersets,
  references_,
  user as userTable,
} from "@episteme/db/schema";
import { storage, paperSourceKey, paperCoverKey } from "@/lib/storage";
import { ensureMinIOReady } from "@/app/api/_minio-setup";
import { seedAnonymousUser } from "./seed-anonymous-user";
import type { CslItem } from "./csl";

const createdUserIds: string[] = [];

function makeAnonId(): string {
  return `anon_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function insertAnonymousUser(): Promise<string> {
  const id = makeAnonId();
  await db.insert(userTable).values({
    id,
    name: "Anonymous",
    email: `${id}@anon.local`,
    isAnonymous: true,
  });
  createdUserIds.push(id);
  return id;
}

beforeAll(async () => {
  await ensureMinIOReady();
});

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  // Drop MinIO objects before users — once papers cascade-delete, we lose the
  // paperId needed to compute the storage key.
  for (const userId of createdUserIds) {
    const rows = await db
      .select({ id: papers.id })
      .from(papers)
      .where(eq(papers.userId, userId));
    await Promise.all(
      rows.flatMap((r) => [
        storage.deleteObject(paperSourceKey(r.id)).catch(() => {}),
        storage.deleteObject(paperCoverKey(r.id)).catch(() => {}),
      ]),
    );
  }
  await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
});

describe("seedAnonymousUser", () => {
  it("creates library + TRASH + nested Reading List/Foundations + welcome note + paper (cover + PDF in MinIO) + 5 references", { timeout: 60_000 }, async () => {
    const userId = await insertAnonymousUser();

    await seedAnonymousUser(userId);

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);
    expect(libs[0].name).toBe("Example Library");

    const allFolders = await db
      .select()
      .from(folders)
      .where(eq(folders.libraryId, libs[0].id));
    const trashFolders = allFolders.filter((f) => f.isTrash);
    expect(trashFolders).toHaveLength(1);
    const readingList = allFolders.find((f) => f.name === "Reading List");
    const foundations = allFolders.find((f) => f.name === "Foundations");
    expect(readingList).toBeDefined();
    expect(foundations).toBeDefined();
    expect(foundations!.parentId).toBe(readingList!.id);

    const noteRows = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, userId));
    expect(noteRows).toHaveLength(3);
    const welcomeNote = noteRows.find((n) => n.title === "Welcome to Episteme");
    expect(welcomeNote).toBeDefined();
    expect(welcomeNote!.contentMd).toContain("# Welcome to Episteme");
    // Markdown cheatsheet sentence is included so guests can discover syntax.
    expect(welcomeNote!.contentMd).toContain("**bold**");
    expect(welcomeNote!.contentMd).toContain("*italic*");
    expect(welcomeNote!.contentMd).toContain("`code`");

    const paperRows = await db
      .select()
      .from(papers)
      .where(eq(papers.userId, userId));
    // 1 RAG seed paper at root + 3 PCA folder PDFs.
    expect(paperRows).toHaveLength(6);
    const ragPaper = paperRows.find((p) => p.filename === "2005.11401.pdf");
    expect(ragPaper).toBeDefined();
    expect(ragPaper!.doi).toBe("10.48550/arXiv.2005.11401");
    expect(ragPaper!.title).toBe(
      "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    );
    expect(ragPaper!.year).toBe(2020);
    expect(ragPaper!.authors?.[0]).toBe("Patrick Lewis");

    const sourceHead = await fetch(
      await storage.getPresignedHead(paperSourceKey(ragPaper!.id), 30),
      { method: "HEAD" },
    );
    expect(sourceHead.status).toBe(200);
    const coverHead = await fetch(
      await storage.getPresignedHead(paperCoverKey(ragPaper!.id), 30),
      { method: "HEAD" },
    );
    expect(coverHead.status).toBe(200);

    // The 3 PCA papers all live in the PCA folder, with PDF source uploaded.
    const pcaPapers = paperRows.filter((p) =>
      p.filename.startsWith("pca-paper-"),
    );
    expect(pcaPapers).toHaveLength(3);
    for (const p of pcaPapers) {
      expect(p.title).toBeTruthy();
      const head = await fetch(
        await storage.getPresignedHead(paperSourceKey(p.id), 30),
        { method: "HEAD" },
      );
      expect(head.status).toBe(200);
    }

    const refRows = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, userId));
    // 5 original demo refs + 6 PCA references seeded into a "PCA" folder.
    expect(refRows).toHaveLength(12);
    const dois = refRows.map((r) => (r.cslJson as CslItem).DOI).sort();
    expect(dois).toContain("10.1038/s41586-021-03819-2");
    expect(dois).toContain("10.48550/arXiv.1706.03762");
    // PCA canon
    expect(dois).toContain("10.1080/14786440109462720"); // Pearson 1901
    expect(dois).toContain("10.1037/h0071325"); // Hotelling 1933
    expect(dois).toContain("10.1111/1467-9868.00196"); // Tipping & Bishop 1999
    expect(dois).toContain("10.1038/nature07331"); // Novembre et al. 2008
    expect(dois).toContain("10.1162/jocn.1991.3.1.71"); // Turk & Pentland 1991
    const pcaFolder = allFolders.find((f) => f.name === "PSM");
    expect(pcaFolder).toBeDefined();
    const pcaRefs = refRows.filter((r) => r.folderId === pcaFolder!.id);
    expect(pcaRefs).toHaveLength(6);
    const rootRef = refRows.find(
      (r) => (r.cslJson as CslItem).DOI === "10.1038/s41586-021-03819-2",
    );
    expect(rootRef!.folderPath).toBe("");
    const nestedRef = refRows.find(
      (r) => (r.cslJson as CslItem).DOI === "10.48550/arXiv.1706.03762",
    );
    expect(nestedRef!.folderPath).toBe("Reading List/Foundations");
    expect(nestedRef!.folderId).toBe(foundations!.id);

    // PCA paperset CSV is seeded inside the PCA folder, with two columns
    // ("Uses PCA" + "Variables matched on") and one row per PCA reference.
    const psRows = await db
      .select()
      .from(papersets)
      .where(eq(papersets.userId, userId));
    expect(psRows).toHaveLength(1);
    expect(psRows[0].filename).toMatch(/\.csv$/);
    expect(psRows[0].folderId).toBe(pcaFolder!.id);
    expect(psRows[0].columns).toHaveLength(2);
    const colNames = psRows[0].columns.map((c) => c.name);
    expect(colNames).toContain("Uses PCA");
    expect(colNames).toContain("Variables matched on");
    expect(psRows[0].rowRefs).toHaveLength(3);
    for (const row of psRows[0].rowRefs) {
      expect(typeof row.paper_id).toBe("string");
      expect(row.paper_id.length).toBeGreaterThan(0);
    }
    // All seeded rowRefs reference real PCA paper IDs (no reference-only rows).
    const paperIds = new Set(pcaPapers.map((p) => p.id));
    const rowRefIds = psRows[0].rowRefs.map((r) => r.paper_id);
    const matchedPaperIds = rowRefIds.filter((id) => paperIds.has(id));
    expect(matchedPaperIds).toHaveLength(3);
  });

  it("is idempotent on a second call for the same user", { timeout: 60_000 }, async () => {
    const userId = await insertAnonymousUser();

    await seedAnonymousUser(userId);
    await seedAnonymousUser(userId);

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);

    const noteRows = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, userId));
    expect(noteRows).toHaveLength(3);

    const paperRows = await db
      .select()
      .from(papers)
      .where(eq(papers.userId, userId));
    expect(paperRows).toHaveLength(6);

    const refRows = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, userId));
    expect(refRows).toHaveLength(12);
  });

  it("recovers from a partial seed (orphan library, no other rows)", { timeout: 60_000 }, async () => {
    const userId = await insertAnonymousUser();

    await db.insert(libraries).values({ userId, name: "My Library" });

    await seedAnonymousUser(userId);

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);

    const noteRows = await db
      .select()
      .from(notes)
      .where(eq(notes.userId, userId));
    expect(noteRows).toHaveLength(3);

    const paperRows = await db
      .select()
      .from(papers)
      .where(eq(papers.userId, userId));
    expect(paperRows).toHaveLength(6);

    const refRows = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, userId));
    expect(refRows).toHaveLength(12);
  });
});
