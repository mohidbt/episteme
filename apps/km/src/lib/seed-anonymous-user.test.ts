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
import { storage, paperSourceKey } from "@/lib/storage";
import { ensureMinIOReady } from "@/app/api/_minio-setup";
import { seedAnonymousUser } from "./seed-anonymous-user";
import type { CslItem } from "./csl";

// Fixed CSL for AlphaFold paper — keeps the test offline.
const ALPHAFOLD_CSL: CslItem = {
  id: "10.1038/s41586-021-03819-2",
  type: "article-journal",
  DOI: "10.1038/s41586-021-03819-2",
  title: "Highly accurate protein structure prediction with AlphaFold",
  author: [
    { family: "Jumper", given: "John" },
    { family: "Evans", given: "Richard" },
  ],
  issued: { "date-parts": [[2021, 8, 26]] },
  "container-title": "Nature",
};

const fakeFetchCrossRef = async (_doi: string) => ALPHAFOLD_CSL;

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
  if (createdUserIds.length > 0) {
    await db.delete(userTable).where(inArray(userTable.id, createdUserIds));
  }
});

describe("seedAnonymousUser", () => {
  it("creates 1 library + TRASH folder + 1 note + 1 paper (PDF in MinIO) + 1 reference", async () => {
    const userId = await insertAnonymousUser();

    await seedAnonymousUser(userId, { fetchCrossRef: fakeFetchCrossRef });

    const libs = await db
      .select()
      .from(libraries)
      .where(eq(libraries.userId, userId));
    expect(libs).toHaveLength(1);
    expect(libs[0].name).toBe("My Library");

    const trashFolders = await db
      .select()
      .from(folders)
      .where(
        and(eq(folders.libraryId, libs[0].id), eq(folders.isTrash, true)),
      );
    expect(trashFolders).toHaveLength(1);

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

    // Confirm the PDF actually landed in MinIO.
    const headUrl = await storage.getPresignedHead(
      paperSourceKey(paperRows[0].id),
      30,
    );
    const headRes = await fetch(headUrl, { method: "HEAD" });
    expect(headRes.status).toBe(200);
    expect(Number(headRes.headers.get("content-length"))).toBeGreaterThan(0);

    const refRows = await db
      .select()
      .from(references_)
      .where(eq(references_.userId, userId));
    expect(refRows).toHaveLength(1);
    expect((refRows[0].cslJson as CslItem).DOI).toBe(
      "10.1038/s41586-021-03819-2",
    );
    // Citation key derives from author family + year + first substantial title word
    // ("Highly" — "highly" is not a stop word).
    expect(refRows[0].citationKey).toBe("jumper2021highly");
  });

  it("is idempotent on a second call for the same user", async () => {
    const userId = await insertAnonymousUser();

    await seedAnonymousUser(userId, { fetchCrossRef: fakeFetchCrossRef });
    await seedAnonymousUser(userId, { fetchCrossRef: fakeFetchCrossRef });

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
    expect(refRows).toHaveLength(1);
  });
});
