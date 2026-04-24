import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { folders, libraries, references_ } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { listAllReferences } from "@/lib/references-server";
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

  // Reference 1: root (no folder)
  await db.insert(references_).values({
    libraryId,
    userId: u.id,
    folderId: null,
    citationKey: `root-ref-${Date.now()}`,
    cslJson: { title: "Root Reference" },
    folderPath: "",
  });

  // Reference 2: in sub-folder
  await db.insert(references_).values({
    libraryId,
    userId: u.id,
    folderId: subFolderId,
    citationKey: `research-ref-${Date.now()}`,
    cslJson: { title: "Research Reference" },
    folderPath: "Research",
  });

  // Reference 3: in trash
  await db.insert(references_).values({
    libraryId,
    userId: u.id,
    folderId: trashFolderId,
    citationKey: `trash-ref-${Date.now()}`,
    cslJson: { title: "Trashed Reference" },
    folderPath: "",
  });
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("listAllReferences", () => {
  it("returns all references in the library including root and sub-folder references", async () => {
    const rows = await listAllReferences(libraryId, u.id);
    const csls = rows.map((r) => (r.cslJson as { title?: string } | null)?.title);
    expect(csls).toContain("Root Reference");
    expect(csls).toContain("Research Reference");
  });

  it("includes references in trash folder (caller filters)", async () => {
    const rows = await listAllReferences(libraryId, u.id);
    const csls = rows.map((r) => (r.cslJson as { title?: string } | null)?.title);
    expect(csls).toContain("Trashed Reference");
  });
});

describe("references page folder filtering + breadcrumb logic", () => {
  it("filters to only the sub-folder reference when folderFilter matches", async () => {
    const allRows = await listAllReferences(libraryId, u.id);
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];

    const folderFilter = subFolderId;
    const filtered = allRows.filter((r) => r.folderId === folderFilter);

    const csls = filtered.map((r) => (r.cslJson as { title?: string } | null)?.title);
    expect(csls).toContain("Research Reference");
    expect(csls).not.toContain("Root Reference");
    expect(csls).not.toContain("Trashed Reference");
  });

  it("excludes trash references when no filter is applied", async () => {
    const allRows = await listAllReferences(libraryId, u.id);
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];

    const visibleRows = allRows.filter((ref) => {
      if (!ref.folderId) return true;
      const chain = resolveChain(allFolderRows, ref.folderId);
      return !chain.some((f) => f.isTrash);
    });

    const csls = visibleRows.map((r) => (r.cslJson as { title?: string } | null)?.title);
    expect(csls).toContain("Root Reference");
    expect(csls).toContain("Research Reference");
    expect(csls).not.toContain("Trashed Reference");
  });

  it("generates correct breadcrumb for sub-folder reference", async () => {
    const allFolderRows = [
      { id: trashFolderId, parentId: null, name: "Trash", isTrash: true },
      { id: subFolderId, parentId: null, name: "Research", isTrash: false },
    ];
    const chain = resolveChain(allFolderRows, subFolderId);
    const crumb = breadcrumbFromChain(chain);
    expect(crumb).toBe("Research");
  });
});
