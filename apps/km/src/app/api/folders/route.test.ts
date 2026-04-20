import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, papers } from "@episteme/db/schema";
import { POST as POST_RENAME } from "./rename/route";
import { POST as POST_DELETE } from "./delete/route";
import { POST as POST_LIB } from "../libraries/route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Folders Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function seedNote(folderPath: string, title: string): Promise<string> {
  const [row] = await db
    .insert(notes)
    .values({
      libraryId,
      userId: u.id,
      folderPath,
      title,
      slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning({ id: notes.id });
  return row.id;
}

async function seedPaper(folderPath: string, filename: string): Promise<string> {
  const [row] = await db
    .insert(papers)
    .values({
      libraryId,
      userId: u.id,
      folderPath,
      filename,
      storageUrl: `s3://x/${filename}`,
      title: filename,
    })
    .returning({ id: papers.id });
  return row.id;
}

async function getNoteFolderPath(id: string): Promise<string | undefined> {
  const rows = await db.select({ folderPath: notes.folderPath }).from(notes).where(eq(notes.id, id));
  return rows[0]?.folderPath;
}

async function getPaperFolderPath(id: string): Promise<string | undefined> {
  const rows = await db.select({ folderPath: papers.folderPath }).from(papers).where(eq(papers.id, id));
  return rows[0]?.folderPath;
}

describe("folders/rename", () => {
  it("401 no user", async () => {
    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        body: JSON.stringify({ libraryId, section: "notes", oldPath: "a/", newPath: "b/" }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 invalid body", async () => {
    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, section: "notes" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("404 cross-user library", async () => {
    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ libraryId, section: "notes", oldPath: "a/", newPath: "b/" }),
      }),
    );
    expect(r.status).toBe(404);
  });

  it("400 oldPath === newPath", async () => {
    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, section: "notes", oldPath: "same/", newPath: "same/" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("400 cycle: newPath starts with oldPath", async () => {
    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, section: "notes", oldPath: "a/", newPath: "a/b/" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("renames folder + descendants, skips unrelated", async () => {
    const nA = await seedNote("projects/phd/", "phd root");
    const nB = await seedNote("projects/phd/chapter-1/", "phd chapter 1");
    const nC = await seedNote("other/", "other note");

    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          section: "notes",
          oldPath: "projects/phd/",
          newPath: "phd/",
        }),
      }),
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.updatedCount).toBe(2);

    expect(await getNoteFolderPath(nA)).toBe("phd/");
    expect(await getNoteFolderPath(nB)).toBe("phd/chapter-1/");
    expect(await getNoteFolderPath(nC)).toBe("other/");

    await db.delete(notes).where(and(eq(notes.userId, u.id), eq(notes.libraryId, libraryId)));
  });

  it("cross-table isolation", async () => {
    const paperId = await seedPaper("inbox/", "p.pdf");
    const noteId = await seedNote("inbox/", "note in inbox");

    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          libraryId,
          section: "notes",
          oldPath: "inbox/",
          newPath: "archive/",
        }),
      }),
    );
    expect(r.status).toBe(200);

    expect(await getPaperFolderPath(paperId)).toBe("inbox/");
    expect(await getNoteFolderPath(noteId)).toBe("archive/");

    await db.delete(notes).where(and(eq(notes.userId, u.id), eq(notes.libraryId, libraryId)));
    await db.delete(papers).where(and(eq(papers.userId, u.id), eq(papers.libraryId, libraryId)));
  });
});

describe("folders/delete", () => {
  it("400 empty path (cannot delete section root)", async () => {
    const r = await POST_DELETE(
      req("/api/folders/delete", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, section: "notes", path: "" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("404 cross-user library", async () => {
    const r = await POST_DELETE(
      req("/api/folders/delete", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ libraryId, section: "notes", path: "any/" }),
      }),
    );
    expect(r.status).toBe(404);
  });

  it("deletes folder + descendants, leaves siblings", async () => {
    const nA = await seedNote("x/", "x root");
    const nB = await seedNote("x/y/", "x y child");
    const nC = await seedNote("z/", "z note");

    const r = await POST_DELETE(
      req("/api/folders/delete", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, section: "notes", path: "x/" }),
      }),
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.deletedCount).toBe(2);

    expect(await getNoteFolderPath(nA)).toBeUndefined();
    expect(await getNoteFolderPath(nB)).toBeUndefined();
    expect(await getNoteFolderPath(nC)).toBe("z/");

    await db.delete(notes).where(and(eq(notes.userId, u.id), eq(notes.libraryId, libraryId)));
  });
});
