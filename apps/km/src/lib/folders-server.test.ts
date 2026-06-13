import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { folders, libraries, notes, papers, papersets, references_ } from "@episteme/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  createFolder, moveFolder, moveItemToFolder, moveToTrash, restoreFromTrash, emptyTrash,
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

  // GSD-93: ref-twins (paperId IS NOT NULL) must be hidden from drive grid,
  // matching sidebar tree filter in lib/tree-server.ts.
  it("hides ref-twins (paperId set) from drive listing", async () => {
    const [folder] = await db.insert(folders)
      .values({ libraryId, userId: u.id, name: `RefHide-${Date.now()}` })
      .returning({ id: folders.id });
    const [p] = await db.insert(papers).values({
      libraryId, userId: u.id, folderId: folder.id, filename: `gsd93-${Date.now()}.pdf`,
    }).returning({ id: papers.id });
    // Hidden ref-twin (auto-created on upload).
    await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: folder.id,
      citationKey: `twin-${Date.now()}`, cslJson: { title: "twin" },
      paperId: p.id,
    });
    // Standalone reference (visible).
    await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: folder.id,
      citationKey: `solo-${Date.now()}`, cslJson: { title: "solo" },
    });

    const out = await listFolderContents(libraryId, u.id, folder.id);
    expect(out.references).toHaveLength(1);
    expect(out.references[0].title).toBe("solo");
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

describe("moveItemToFolder (GSD-76: paper ref-twin follows)", () => {
  it("moving a paper moves its hidden ref-twin (paperId-linked) to the same folder", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "Dest" });
    const [p] = await db.insert(papers).values({
      libraryId, userId: u.id, filename: `p-${Date.now()}.pdf`,
    }).returning({ id: papers.id });
    const [r] = await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: null,
      citationKey: `pk-${Date.now()}`, cslJson: { id: p.id, title: "twin" },
      paperId: p.id,
    }).returning({ id: references_.id });

    await moveItemToFolder({ kind: "paper", itemId: p.id, userId: u.id, targetFolderId: f.id });

    const [paperRow] = await db.select({ folderId: papers.folderId })
      .from(papers).where(eq(papers.id, p.id));
    const [refRow] = await db.select({ folderId: references_.folderId })
      .from(references_).where(eq(references_.id, r.id));
    expect(paperRow.folderId).toBe(f.id);
    expect(refRow.folderId).toBe(f.id);
  });

  it("does not touch refs without paperId", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "Dest2" });
    const [p] = await db.insert(papers).values({
      libraryId, userId: u.id, filename: `p2-${Date.now()}.pdf`,
    }).returning({ id: papers.id });
    const [otherRef] = await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: null,
      citationKey: `or-${Date.now()}`, cslJson: { id: "x", title: "unlinked" },
    }).returning({ id: references_.id });

    await moveItemToFolder({ kind: "paper", itemId: p.id, userId: u.id, targetFolderId: f.id });

    const [refRow] = await db.select({ folderId: references_.folderId })
      .from(references_).where(eq(references_.id, otherRef.id));
    expect(refRow.folderId).toBeNull();
  });
});

describe("moveToTrash / restoreFromTrash paper (GSD-97: ref-twin follows)", () => {
  it("moveToTrash(paper) cascades to ref-twin: twin folderId=trash, prev=origFolder", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "T-A" });
    const [p] = await db.insert(papers).values({
      libraryId, userId: u.id, folderId: f.id, filename: `tp-${Date.now()}.pdf`,
    }).returning({ id: papers.id });
    const [r] = await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: f.id,
      citationKey: `tk-${Date.now()}`, cslJson: { id: p.id, title: "twin" },
      paperId: p.id,
    }).returning({ id: references_.id });

    await moveToTrash({ libraryId, userId: u.id, target: { kind: "paper", id: p.id } });

    const [refRow] = await db.select({
      folderId: references_.folderId, prev: references_.prevFolderId,
    }).from(references_).where(eq(references_.id, r.id));
    expect(refRow.folderId).toBe(trashId);
    expect(refRow.prev).toBe(f.id);
  });

  it("restoreFromTrash(paper) restores ref-twin to its prev folder", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "T-B" });
    const [p] = await db.insert(papers).values({
      libraryId, userId: u.id, folderId: f.id, filename: `tp2-${Date.now()}.pdf`,
    }).returning({ id: papers.id });
    const [r] = await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: f.id,
      citationKey: `tk2-${Date.now()}`, cslJson: { id: p.id, title: "twin" },
      paperId: p.id,
    }).returning({ id: references_.id });

    await moveToTrash({ libraryId, userId: u.id, target: { kind: "paper", id: p.id } });
    await restoreFromTrash({ libraryId, userId: u.id, target: { kind: "paper", id: p.id } });

    const [refRow] = await db.select({
      folderId: references_.folderId, prev: references_.prevFolderId,
    }).from(references_).where(eq(references_.id, r.id));
    expect(refRow.folderId).toBe(f.id);
    expect(refRow.prev).toBeNull();
  });

  it("emptyTrash deletes the ref-twin that followed the paper into trash", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "T-C" });
    const [p] = await db.insert(papers).values({
      libraryId, userId: u.id, folderId: f.id, filename: `tp3-${Date.now()}.pdf`,
    }).returning({ id: papers.id });
    const [r] = await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: f.id,
      citationKey: `tk3-${Date.now()}`, cslJson: { id: p.id, title: "twin" },
      paperId: p.id,
    }).returning({ id: references_.id });

    await moveToTrash({ libraryId, userId: u.id, target: { kind: "paper", id: p.id } });
    await emptyTrash({ libraryId, userId: u.id });

    const refLeft = await db.select().from(references_).where(eq(references_.id, r.id));
    expect(refLeft).toHaveLength(0);
  });

  it("moveToTrash(paper) does not touch unrelated refs (no paperId match)", async () => {
    const f = await createFolder({ libraryId, userId: u.id, parentId: null, name: "T-D" });
    const [p] = await db.insert(papers).values({
      libraryId, userId: u.id, folderId: f.id, filename: `tp4-${Date.now()}.pdf`,
    }).returning({ id: papers.id });
    const [other] = await db.insert(references_).values({
      libraryId, userId: u.id, folderPath: "", folderId: f.id,
      citationKey: `or-${Date.now()}`, cslJson: { id: "x", title: "unlinked" },
    }).returning({ id: references_.id });

    await moveToTrash({ libraryId, userId: u.id, target: { kind: "paper", id: p.id } });

    const [refRow] = await db.select({ folderId: references_.folderId })
      .from(references_).where(eq(references_.id, other.id));
    expect(refRow.folderId).toBe(f.id);
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
