import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { folders, libraries, papers, papersets } from "@episteme/db/schema";
import { papersetCountForPaper, papersetsForPaper } from "./papersets-server";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";

let u: TestUser;
let libraryId: number;
let trashId: string;
let paperId: string;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "t" })
    .returning({ id: libraries.id });
  libraryId = lib.id;
  const [tr] = await db
    .insert(folders)
    .values({ libraryId, userId: u.id, parentId: null, name: "Trash", isTrash: true })
    .returning({ id: folders.id });
  trashId = tr.id;
  const [p] = await db
    .insert(papers)
    .values({ libraryId, userId: u.id, filename: "x.pdf", storageUrl: "s3://x" })
    .returning({ id: papers.id });
  paperId = p.id;
});
afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("papersetCountForPaper", () => {
  it("returns 0 when no paperset references the paper", async () => {
    expect(await papersetCountForPaper(paperId, u.id)).toBe(0);
  });

  it("counts papersets whose row_refs contains paper_id", async () => {
    await db.insert(papersets).values({
      libraryId,
      userId: u.id,
      filename: "a.csv",
      rowRefs: [{ paper_id: paperId }],
    });
    await db.insert(papersets).values({
      libraryId,
      userId: u.id,
      filename: "b.csv",
      rowRefs: [
        { paper_id: paperId },
        { paper_id: "00000000-0000-0000-0000-000000000000" },
      ],
    });
    expect(await papersetCountForPaper(paperId, u.id)).toBe(2);
  });

  it("ignores papersets in trash", async () => {
    await db.insert(papersets).values({
      libraryId,
      userId: u.id,
      folderId: trashId,
      filename: "trashed.csv",
      rowRefs: [{ paper_id: paperId }],
    });
    // count should still be 2 (the two non-trashed from previous test)
    expect(await papersetCountForPaper(paperId, u.id)).toBe(2);
  });
});

describe("papersetsForPaper", () => {
  it("returns non-trashed papersets referencing the paper", async () => {
    const rows = await papersetsForPaper(paperId, u.id);
    expect(rows).toHaveLength(2);
    const filenames = rows.map((r) => r.filename).sort();
    expect(filenames).toEqual(["a.csv", "b.csv"]);
  });
});
