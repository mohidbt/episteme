import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  folders,
  libraries,
  notes,
  papers,
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
  it("creates library + TRASH + nested Reading List/Foundations + welcome note + paper (cover + PDF in MinIO) + 5 references", async () => {
    const userId = await insertAnonymousUser();

    await seedAnonymousUser(userId);

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);
    expect(libs[0].name).toBe("My Library");

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
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0].title).toBe("Welcome to Episteme");
    expect(noteRows[0].contentMd).toContain("# Welcome to Episteme");

    const paperRows = await db
      .select()
      .from(papers)
      .where(eq(papers.userId, userId));
    expect(paperRows).toHaveLength(1);
    expect(paperRows[0].filename).toBe("2005.11401.pdf");
    expect(paperRows[0].doi).toBe("10.48550/arXiv.2005.11401");
    expect(paperRows[0].title).toBe(
      "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    );
    expect(paperRows[0].year).toBe(2020);
    expect(paperRows[0].authors?.[0]).toBe("Patrick Lewis");

    const sourceHead = await fetch(
      await storage.getPresignedHead(paperSourceKey(paperRows[0].id), 30),
      { method: "HEAD" },
    );
    expect(sourceHead.status).toBe(200);
    const coverHead = await fetch(
      await storage.getPresignedHead(paperCoverKey(paperRows[0].id), 30),
      { method: "HEAD" },
    );
    expect(coverHead.status).toBe(200);

    const refRows = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, userId));
    expect(refRows).toHaveLength(5);
    const dois = refRows.map((r) => (r.cslJson as CslItem).DOI).sort();
    expect(dois).toEqual([
      "10.1038/s41586-021-03819-2",
      "10.48550/arXiv.1706.03762",
      "10.48550/arXiv.1810.04805",
      "10.48550/arXiv.2005.14165",
      "10.48550/arXiv.2006.11239",
    ]);
    const rootRef = refRows.find(
      (r) => (r.cslJson as CslItem).DOI === "10.1038/s41586-021-03819-2",
    );
    expect(rootRef!.folderPath).toBe("");
    const nestedRef = refRows.find(
      (r) => (r.cslJson as CslItem).DOI === "10.48550/arXiv.1706.03762",
    );
    expect(nestedRef!.folderPath).toBe("Reading List/Foundations");
    expect(nestedRef!.folderId).toBe(foundations!.id);
  });

  it("is idempotent on a second call for the same user", async () => {
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
    expect(noteRows).toHaveLength(1);

    const paperRows = await db
      .select()
      .from(papers)
      .where(eq(papers.userId, userId));
    expect(paperRows).toHaveLength(1);

    const refRows = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, userId));
    expect(refRows).toHaveLength(5);
  });

  it("recovers from a partial seed (orphan library, no other rows)", async () => {
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
    expect(noteRows).toHaveLength(1);

    const paperRows = await db
      .select()
      .from(papers)
      .where(eq(papers.userId, userId));
    expect(paperRows).toHaveLength(1);

    const refRows = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, userId));
    expect(refRows).toHaveLength(5);
  });
});
