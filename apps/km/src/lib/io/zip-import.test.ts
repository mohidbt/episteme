import { afterAll, beforeAll, describe, expect, it } from "vitest";
import archiver from "archiver";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, notes, references_, papers, folders } from "@episteme/db/schema";
import { storage, paperSourceKey } from "@/lib/storage";
import {
  createTestUser,
  deleteTestUser,
  type TestUser,
} from "../../app/api/_test-utils";
import { ensureMinIOReady } from "../../app/api/_minio-setup";
import { importLibraryZip } from "./zip-import";

const PDF_BYTES = Buffer.from("%PDF-1.4 tiny crispr content\n%%EOF", "utf8");

interface ZipSpec {
  entries: Array<
    | { type: "file"; name: string; body: Buffer | string }
    | { type: "directory"; name: string }
  >;
}

async function buildZip(spec: ZipSpec): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });
  for (const e of spec.entries) {
    if (e.type === "directory") {
      // archiver accepts null for directory entries but its types don't reflect that.
      archive.append(null as unknown as string, {
        name: e.name.endsWith("/") ? e.name : e.name + "/",
      });
    } else {
      archive.append(e.body, { name: e.name });
    }
  }
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

let u: TestUser;
let libraryId: number;
const createdPaperIds: string[] = [];

beforeAll(async () => {
  await ensureMinIOReady();
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "MyLibrary" })
    .returning();
  libraryId = lib.id;
}, 60_000);

afterAll(async () => {
  for (const id of createdPaperIds) {
    await storage.deleteObject(paperSourceKey(id)).catch(() => {});
  }
  await deleteTestUser(u.id);
});

describe("importLibraryZip", () => {
  it("imports notes, references, and papers at the expected folder paths", async () => {
    const zipBuf = await buildZip({
      entries: [
        { type: "directory", name: "MyLibrary/" },
        { type: "directory", name: "MyLibrary/notes/" },
        { type: "directory", name: "MyLibrary/notes/inbox/" },
        {
          type: "file",
          name: "MyLibrary/notes/inbox/quick-idea.md",
          body: "quick idea body",
        },
        {
          type: "file",
          name: "MyLibrary/notes/projects/phd/chapter-2.md",
          body: '---\ntitle: "Chapter 2: Methods"\n---\n\nchapter body',
        },
        {
          type: "file",
          name: "MyLibrary/notes/welcome.md",
          body: "# Welcome\n\nhello",
        },
        {
          type: "file",
          name: "MyLibrary/references/classics/vaswani2017attention.json",
          body: JSON.stringify({
            id: "vaswani2017attention",
            type: "article-journal",
            title: "Attention Is All You Need",
          }),
        },
        {
          type: "file",
          name: "MyLibrary/papers/biology/crispr-paper.pdf",
          body: PDF_BYTES,
        },
      ],
    });

    const result = await importLibraryZip(u.id, libraryId, zipBuf);
    expect(result.imported).toBe(5);

    // Notes: three rows with correct folder_path and title resolution.
    const noteRows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.libraryId, libraryId), eq(notes.userId, u.id)));
    expect(noteRows).toHaveLength(3);
    const byFolder = new Map(noteRows.map((n) => [n.folderPath, n]));
    expect(byFolder.get("")).toBeTruthy();
    expect(byFolder.get("inbox/")).toBeTruthy();
    expect(byFolder.get("projects/phd/")).toBeTruthy();

    // Frontmatter title on chapter-2.md beats filename.
    const chapter = byFolder.get("projects/phd/")!;
    expect(chapter.title).toBe("Chapter 2: Methods");
    expect(chapter.filename).toBe("chapter-2.md");
    // Body only — frontmatter stripped.
    expect(chapter.contentMd).toBe("\nchapter body");

    const welcome = byFolder.get("")!;
    expect(welcome.title).toBe("welcome");
    expect(welcome.slug).toBe("welcome");

    const inbox = byFolder.get("inbox/")!;
    expect(inbox.slug).toBe("quick-idea");
    expect(inbox.title).toBe("quick-idea");

    // Reference: folder, citation_key, CSL JSON round-trip.
    const refRows = await db
      .select()
      .from(references_)
      .where(and(eq(references_.libraryId, libraryId), eq(references_.userId, u.id)));
    expect(refRows).toHaveLength(1);
    expect(refRows[0].folderPath).toBe("classics/");
    expect(refRows[0].citationKey).toBe("vaswani2017attention");
    expect((refRows[0].cslJson as { title?: string }).title).toBe("Attention Is All You Need");

    // Paper row + MinIO object.
    const paperRows = await db
      .select()
      .from(papers)
      .where(and(eq(papers.libraryId, libraryId), eq(papers.userId, u.id)));
    expect(paperRows).toHaveLength(1);
    expect(paperRows[0].folderPath).toBe("biology/");
    expect(paperRows[0].filename).toBe("crispr-paper.pdf");
    // extractMetadata on a non-PDF payload falls back to filename-derived title.
    expect(paperRows[0].title).toBe("crispr-paper");
    createdPaperIds.push(paperRows[0].id);

    // MinIO object exists.
    const headUrl = await storage.getPresignedHead(paperSourceKey(paperRows[0].id), 30);
    const head = await fetch(headUrl, { method: "HEAD" });
    expect(head.status).toBe(200);
  }, 60_000);

  it("rejects zips with path-traversal entries", async () => {
    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "MyLibrary/notes/../etc/passwd",
          body: "root:x:0:0:",
        },
      ],
    });
    await expect(importLibraryZip(u.id, libraryId, zipBuf)).rejects.toMatchObject({
      code: "path_traversal",
    });
  });

  it("re-import with existing slug does not overwrite; new note gets suffix", async () => {
    // First import seeded welcome (slug 'welcome') — run another with same slug.
    const before = await db
      .select()
      .from(notes)
      .where(and(eq(notes.libraryId, libraryId), eq(notes.slug, "welcome")));
    expect(before).toHaveLength(1);
    const beforeBody = before[0].contentMd;

    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "MyLibrary/notes/welcome.md",
          body: "# New Welcome\n\nsecond import",
        },
      ],
    });
    const result = await importLibraryZip(u.id, libraryId, zipBuf);
    expect(result.imported).toBe(1);

    const after = await db
      .select()
      .from(notes)
      .where(and(eq(notes.userId, u.id), eq(notes.title, "welcome")));
    // Two rows now: welcome + welcome-2
    const slugs = after.map((n) => n.slug).sort();
    expect(slugs).toEqual(["welcome", "welcome-2"]);

    // Original body untouched.
    const original = after.find((n) => n.slug === "welcome")!;
    expect(original.contentMd).toBe(beforeBody);
  });

  it("skips directory-only entries without crashing", async () => {
    const zipBuf = await buildZip({
      entries: [
        { type: "directory", name: "MyLibrary/notes/empty-folder/" },
      ],
    });
    const result = await importLibraryZip(u.id, libraryId, zipBuf);
    expect(result.imported).toBe(0);
  });
});

describe("importLibraryZip — folder_id population (T22)", () => {
  let u2: TestUser;
  let lib2Id: number;

  beforeAll(async () => {
    await ensureMinIOReady();
    u2 = await createTestUser();
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u2.id, name: "T22Lib" })
      .returning();
    lib2Id = lib.id;
  }, 60_000);

  afterAll(async () => {
    await deleteTestUser(u2.id);
  });

  it("nested entry a/b/note.md under rootFolderId creates folder rows and sets note.folder_id to deepest", async () => {
    // Create a root folder X
    const [rootFolder] = await db
      .insert(folders)
      .values({ libraryId: lib2Id, userId: u2.id, parentId: null, name: "Root" })
      .returning();
    const rootFolderId = rootFolder.id;

    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "T22Lib/notes/a/b/note.md",
          body: "hello nested",
        },
      ],
    });

    await importLibraryZip(u2.id, lib2Id, zipBuf, rootFolderId);

    // Folder "a" should be under rootFolderId
    const [folderA] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.libraryId, lib2Id), eq(folders.userId, u2.id), eq(folders.name, "a")));
    expect(folderA).toBeTruthy();
    expect(folderA.parentId).toBe(rootFolderId);

    // Folder "b" should be under "a"
    const [folderB] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.libraryId, lib2Id), eq(folders.userId, u2.id), eq(folders.name, "b")));
    expect(folderB).toBeTruthy();
    expect(folderB.parentId).toBe(folderA.id);

    // The note's folder_id should be folder "b"
    const [noteRow] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.libraryId, lib2Id), eq(notes.userId, u2.id)));
    expect(noteRow.folderId).toBe(folderB.id);
  }, 60_000);

  it("top-level entry note.md under rootFolderId sets folder_id = rootFolderId without creating sub-folders", async () => {
    const lib2Folders = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.libraryId, lib2Id), eq(folders.userId, u2.id)));
    const folderCountBefore = lib2Folders.length;

    // Create a separate library to isolate
    const [lib3] = await db
      .insert(libraries)
      .values({ userId: u2.id, name: "T22LibToplevel" })
      .returning();
    const [rootFolder] = await db
      .insert(folders)
      .values({ libraryId: lib3.id, userId: u2.id, parentId: null, name: "RootToplevel" })
      .returning();
    const rootFolderId = rootFolder.id;

    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "T22LibToplevel/notes/note.md",
          body: "top-level note",
        },
      ],
    });

    await importLibraryZip(u2.id, lib3.id, zipBuf, rootFolderId);

    // No new sub-folders created under rootFolderId
    const subFolders = await db
      .select()
      .from(folders)
      .where(and(eq(folders.libraryId, lib3.id), eq(folders.userId, u2.id), eq(folders.parentId, rootFolderId)));
    expect(subFolders).toHaveLength(0);

    // Note's folder_id = rootFolderId
    const [noteRow] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.libraryId, lib3.id), eq(notes.userId, u2.id)));
    expect(noteRow.folderId).toBe(rootFolderId);
  }, 60_000);

  it("null rootFolderId with entry a/note.md creates folder at library root (parentId=null)", async () => {
    const [lib4] = await db
      .insert(libraries)
      .values({ userId: u2.id, name: "T22LibNullRoot" })
      .returning();

    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "T22LibNullRoot/notes/a/note.md",
          body: "note with null root",
        },
      ],
    });

    await importLibraryZip(u2.id, lib4.id, zipBuf, null);

    // Folder "a" created at library root (parentId = null)
    const [folderA] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.libraryId, lib4.id), eq(folders.userId, u2.id), eq(folders.name, "a")));
    expect(folderA).toBeTruthy();
    expect(folderA.parentId).toBeNull();

    // Note's folder_id = folder "a"
    const [noteRow] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.libraryId, lib4.id), eq(notes.userId, u2.id)));
    expect(noteRow.folderId).toBe(folderA.id);
  }, 60_000);

  it("re-importing the same zip under the same rootFolderId reuses existing folders (idempotent)", async () => {
    const [lib5] = await db
      .insert(libraries)
      .values({ userId: u2.id, name: "T22LibIdempotent" })
      .returning();
    const [rootFolder] = await db
      .insert(folders)
      .values({ libraryId: lib5.id, userId: u2.id, parentId: null, name: "RootIdempotent" })
      .returning();
    const rootFolderId = rootFolder.id;

    const zipBuf = await buildZip({
      entries: [
        {
          type: "file",
          name: "T22LibIdempotent/notes/x/y/note.md",
          body: "idempotency test",
        },
      ],
    });

    // First import
    await importLibraryZip(u2.id, lib5.id, zipBuf, rootFolderId);

    const folderCountAfterFirst = await db
      .select({ count: count() })
      .from(folders)
      .where(and(eq(folders.libraryId, lib5.id), eq(folders.userId, u2.id)));

    // Second import (different note slug, same folder structure)
    const zipBuf2 = await buildZip({
      entries: [
        {
          type: "file",
          name: "T22LibIdempotent/notes/x/y/note-second.md",
          body: "second note in same folder",
        },
      ],
    });
    await importLibraryZip(u2.id, lib5.id, zipBuf2, rootFolderId);

    const folderCountAfterSecond = await db
      .select({ count: count() })
      .from(folders)
      .where(and(eq(folders.libraryId, lib5.id), eq(folders.userId, u2.id)));

    // Folder count must be unchanged
    expect(folderCountAfterSecond[0].count).toBe(folderCountAfterFirst[0].count);
  }, 60_000);
});
