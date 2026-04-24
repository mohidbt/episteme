import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { folders, libraries, papers } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { listAllPapers } from "@/lib/papers-server";
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

  // Paper 1: root (no folder)
  await db.insert(papers).values({
    libraryId,
    userId: u.id,
    folderId: null,
    filename: "root-paper.pdf",
    title: "Root Paper",
    folderPath: "",
  });

  // Paper 2: in sub-folder
  await db.insert(papers).values({
    libraryId,
    userId: u.id,
    folderId: subFolderId,
    filename: "research-paper.pdf",
    title: "Research Paper",
    folderPath: "Research",
  });

  // Paper 3: in trash
  await db.insert(papers).values({
    libraryId,
    userId: u.id,
    folderId: trashFolderId,
    filename: "trashed-paper.pdf",
    title: "Trashed Paper",
    folderPath: "",
  });
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("listAllPapers", () => {
  it("returns all papers in the library including root and sub-folder papers", async () => {
    const rows = await listAllPapers(libraryId, u.id);
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Root Paper");
    expect(titles).toContain("Research Paper");
  });

  it("includes papers in trash folder (caller filters)", async () => {
    const rows = await listAllPapers(libraryId, u.id);
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Trashed Paper");
  });
});

describe("papers page folder filtering + breadcrumb logic", () => {
  it("filters to only the sub-folder paper when folderFilter matches", async () => {
    const allRows = await listAllPapers(libraryId, u.id);
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];

    const folderFilter = subFolderId;
    const filtered = allRows.filter((p) => p.folderId === folderFilter);

    const titles = filtered.map((r) => r.title);
    expect(titles).toContain("Research Paper");
    expect(titles).not.toContain("Root Paper");
    expect(titles).not.toContain("Trashed Paper");
  });

  it("excludes trash papers when no filter is applied", async () => {
    const allRows = await listAllPapers(libraryId, u.id);
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];

    const visibleRows = allRows.filter((paper) => {
      if (!paper.folderId) return true;
      const chain = resolveChain(allFolderRows, paper.folderId);
      return !chain.some((f) => f.isTrash);
    });

    const titles = visibleRows.map((r) => r.title);
    expect(titles).toContain("Root Paper");
    expect(titles).toContain("Research Paper");
    expect(titles).not.toContain("Trashed Paper");
  });

  it("generates correct breadcrumb for sub-folder paper", async () => {
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];
    const chain = resolveChain(allFolderRows, subFolderId);
    const crumb = breadcrumbFromChain(chain);
    expect(crumb).toBe("Research");
  });
});
