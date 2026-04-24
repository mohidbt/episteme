import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { folders, libraries, notes } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { listNotes } from "@/lib/notes-server";
import { resolveChain, breadcrumbFromChain } from "@/lib/folders";

let u: TestUser;
let libraryId: number;
let trashFolderId: string;
let subFolderId: string;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Test Library" })
    .returning({ id: libraries.id });
  libraryId = lib.id;

  const [trash] = await db
    .insert(folders)
    .values({ libraryId, userId: u.id, parentId: null, name: "Trash", isTrash: true })
    .returning({ id: folders.id });
  trashFolderId = trash.id;

  const [sub] = await db
    .insert(folders)
    .values({ libraryId, userId: u.id, parentId: null, name: "Research" })
    .returning({ id: folders.id });
  subFolderId = sub.id;

  // Note 1: root (no folder)
  await db.insert(notes).values({
    libraryId,
    userId: u.id,
    folderId: null,
    title: "Root Note",
    slug: `notes-page-test-root-${Date.now()}`,
    contentMd: "",
  });

  // Note 2: in sub-folder
  await db.insert(notes).values({
    libraryId,
    userId: u.id,
    folderId: subFolderId,
    title: "Research Note",
    slug: `notes-page-test-sub-${Date.now()}`,
    contentMd: "",
  });

  // Note 3: in trash
  await db.insert(notes).values({
    libraryId,
    userId: u.id,
    folderId: trashFolderId,
    title: "Trashed Note",
    slug: `notes-page-test-trash-${Date.now()}`,
    contentMd: "",
  });
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("listNotes", () => {
  it("returns all notes for the library including root and sub-folder notes", async () => {
    const rows = await listNotes(libraryId, u.id);
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Root Note");
    expect(titles).toContain("Research Note");
  });

  it("includes notes in trash folder (caller filters)", async () => {
    const rows = await listNotes(libraryId, u.id);
    // listNotes returns all notes; page filters trash notes out
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Trashed Note");
  });
});

describe("notes page trash filtering + breadcrumb logic", () => {
  it("excludes trash notes when filtering by folder chain", async () => {
    const allRows = await listNotes(libraryId, u.id);
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];

    const visibleRows = allRows.filter((note) => {
      if (!note.folderId) return true; // root note — always visible
      const chain = resolveChain(allFolderRows, note.folderId);
      return !chain.some((f) => f.isTrash);
    });

    const titles = visibleRows.map((r) => r.title);
    expect(titles).toContain("Root Note");
    expect(titles).toContain("Research Note");
    expect(titles).not.toContain("Trashed Note");
  });

  it("generates correct breadcrumb for sub-folder note", async () => {
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];
    const chain = resolveChain(allFolderRows, subFolderId);
    const crumb = breadcrumbFromChain(chain);
    expect(crumb).toBe("Research");
  });
});
