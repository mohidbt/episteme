import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { folders, libraries, notes, papersets } from "@episteme/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  createFolder, moveFolder, moveToTrash, restoreFromTrash, emptyTrash,
  getTrashFolderId, listFolderContents,
} from "./folders-server";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";

let u: TestUser; let libraryId: number; let trashId: string;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db.insert(libraries)
    .values({ userId: u.id, name: "t" }).returning({ id: libraries.id });
  libraryId = lib.id;
  const [tr] = await db.insert(folders)
    .values({ libraryId, userId: u.id, parentId: null, name: "Trash", isTrash: true })
    .returning({ id: folders.id });
  trashId = tr.id;
});
afterAll(async () => { await deleteTestUser(u.id); });

describe("moveFolder", () => {
  it("rejects cycle (folder into own descendant)", async () => {
    const a = await createFolder({ libraryId, userId: u.id, parentId: null, name: "A" });
    const b = await createFolder({ libraryId, userId: u.id, parentId: a.id, name: "B" });
    await expect(moveFolder({ folderId: a.id, userId: u.id, targetParentId: b.id }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe("moveToTrash / restoreFromTrash (item)", () => {
  it("preserves prev_folder_id across round-trip", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "Proj" });
    const [n] = await db.insert(notes).values({
      libraryId, userId: u.id, folderId: f.id, title: "t", slug: `s-${Date.now()}`, contentMd: "",
    }).returning({ id: notes.id });

    await moveToTrash({ libraryId, userId: u.id, target: { kind: "note", id: n.id } });
    const [trashed] = await db.select({ folderId: notes.folderId, prev: notes.prevFolderId })
      .from(notes).where(eq(notes.id, n.id));
    expect(trashed.folderId).toBe(trashId);
    expect(trashed.prev).toBe(f.id);

    await restoreFromTrash({ libraryId, userId: u.id, target: { kind: "note", id: n.id } });
    const [restored] = await db.select({ folderId: notes.folderId, prev: notes.prevFolderId })
      .from(notes).where(eq(notes.id, n.id));
    expect(restored.folderId).toBe(f.id);
    expect(restored.prev).toBeNull();
  });
});

describe("listFolderContents", () => {
  it("returns papersets in folder", async () => {
    const [folder] = await db.insert(folders)
      .values({ libraryId, userId: u.id, name: "Eval" })
      .returning({ id: folders.id });
    await db.insert(papersets).values({
      libraryId, userId: u.id, folderId: folder.id, filename: "bench.csv",
    });
    const out = await listFolderContents(libraryId, u.id, folder.id);
    expect(out.papersets).toHaveLength(1);
    expect(out.papersets[0].filename).toBe("bench.csv");
  });
});

describe("emptyTrash", () => {
  it("deletes trash contents but keeps the trash folder itself", async () => {
    const [n] = await db.insert(notes).values({
      libraryId, userId: u.id, folderId: trashId, title: "x", slug: `x-${Date.now()}`, contentMd: "",
    }).returning({ id: notes.id });
    await emptyTrash({ libraryId, userId: u.id });
    const leftover = await db.select().from(notes).where(eq(notes.id, n.id));
    expect(leftover).toHaveLength(0);
    expect(await getTrashFolderId(libraryId, u.id)).toBe(trashId);
  });
});

describe("paperset trash flow", () => {
  it("moveToTrash sets prev_folder_id and folder_id=trash for paperset", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "PS-A" });
    const [ps] = await db.insert(papersets).values({
      libraryId, userId: u.id, folderId: f.id, filename: "a.csv",
    }).returning({ id: papersets.id });

    await moveToTrash({ libraryId, userId: u.id, target: { kind: "paperset", id: ps.id } });
    const [trashed] = await db.select({
      folderId: papersets.folderId, prev: papersets.prevFolderId,
    }).from(papersets).where(eq(papersets.id, ps.id));
    expect(trashed.folderId).toBe(trashId);
    expect(trashed.prev).toBe(f.id);
  });

  it("restoreFromTrash returns paperset to prev_folder_id", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "PS-B" });
    const [ps] = await db.insert(papersets).values({
      libraryId, userId: u.id, folderId: f.id, filename: "b.csv",
    }).returning({ id: papersets.id });

    await moveToTrash({ libraryId, userId: u.id, target: { kind: "paperset", id: ps.id } });
    await restoreFromTrash({ libraryId, userId: u.id, target: { kind: "paperset", id: ps.id } });

    const [row] = await db.select({
      folderId: papersets.folderId, prev: papersets.prevFolderId,
    }).from(papersets).where(eq(papersets.id, ps.id));
    expect(row.folderId).toBe(f.id);
    expect(row.prev).toBeNull();
  });

  it("emptyTrash deletes paperset rows that are in trash", async () => {
    const keepFolder = await createFolder({ libraryId, userId: u.id, parentId: null, name: "PS-Keep" });
    const [inTrash] = await db.insert(papersets).values({
      libraryId, userId: u.id, folderId: trashId, filename: "trashed.csv",
    }).returning({ id: papersets.id });
    const [outside] = await db.insert(papersets).values({
      libraryId, userId: u.id, folderId: keepFolder.id, filename: "kept.csv",
    }).returning({ id: papersets.id });

    await emptyTrash({ libraryId, userId: u.id });

    expect(await db.select().from(papersets).where(eq(papersets.id, inTrash.id))).toHaveLength(0);
    expect(await db.select().from(papersets).where(eq(papersets.id, outside.id))).toHaveLength(1);
  });
});
