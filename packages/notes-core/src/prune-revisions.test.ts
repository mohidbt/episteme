// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, noteRevisions, notes } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { pruneRevisions } from "./prune-revisions";

let u: TestUser;
let libraryId: number;

async function makeNote(): Promise<string> {
  const [note] = await db
    .insert(notes)
    .values({
      userId: u.id,
      libraryId,
      title: "Prune Note",
      slug: `prune-note-${Math.random().toString(36).slice(2)}-${Date.now()}`,
      contentMd: "",
    })
    .returning();
  return note.id;
}

async function allRevs(noteId: string) {
  return db
    .select()
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, noteId));
}

async function countByReason(noteId: string, reason: "autosave" | "manual" | "pre-ai-edit" | "conflict-resolve"): Promise<number> {
  const rows = await db
    .select({ id: noteRevisions.id })
    .from(noteRevisions)
    .where(and(eq(noteRevisions.noteId, noteId), eq(noteRevisions.reason, reason)));
  return rows.length;
}

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Prune Lib" })
    .returning();
  libraryId = lib.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("pruneRevisions", () => {
  it("keeps all manual, pre-ai-edit, and conflict-resolve revisions forever", async () => {
    const noteId = await makeNote();
    const base = Date.now();
    const rows: Array<{
      noteId: string;
      authorId: string | null;
      contentMd: string;
      reason: "autosave" | "manual" | "pre-ai-edit" | "conflict-resolve";
      createdAt: Date;
    }> = [];
    for (let i = 0; i < 10; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `m${i}`, reason: "manual", createdAt: new Date(base - (30 - i) * 1000) });
    }
    for (let i = 0; i < 5; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `p${i}`, reason: "pre-ai-edit", createdAt: new Date(base - (20 - i) * 1000) });
    }
    for (let i = 0; i < 5; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `c${i}`, reason: "conflict-resolve", createdAt: new Date(base - (10 - i) * 1000) });
    }
    await db.insert(noteRevisions).values(rows);

    await pruneRevisions(noteId);

    const remaining = await allRevs(noteId);
    expect(remaining.length).toBe(20);
    expect(await countByReason(noteId, "manual")).toBe(10);
    expect(await countByReason(noteId, "pre-ai-edit")).toBe(5);
    expect(await countByReason(noteId, "conflict-resolve")).toBe(5);
    expect(await countByReason(noteId, "autosave")).toBe(0);
  });

  it("keeps the latest 200 autosave revisions and deletes the rest", async () => {
    const noteId = await makeNote();
    const base = Date.now();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      noteId,
      authorId: u.id,
      contentMd: `a${i}`,
      reason: "autosave" as const,
      // i=0 oldest, i=249 newest
      createdAt: new Date(base - (250 - i) * 1000),
    }));
    await db.insert(noteRevisions).values(rows);

    await pruneRevisions(noteId);

    const remaining = await allRevs(noteId);
    expect(remaining.length).toBe(200);
    // The 200 newest have contentMd a50..a249 (i>=50). Oldest 50 (a0..a49) gone.
    const contents = new Set(remaining.map((r) => r.contentMd));
    for (let i = 0; i < 50; i++) {
      expect(contents.has(`a${i}`)).toBe(false);
    }
    for (let i = 50; i < 250; i++) {
      expect(contents.has(`a${i}`)).toBe(true);
    }
  });

  it("keeps all non-autosave AND latest 200 autosave in combination", async () => {
    const noteId = await makeNote();
    const base = Date.now();
    const rows: Array<{
      noteId: string;
      authorId: string | null;
      contentMd: string;
      reason: "autosave" | "manual" | "pre-ai-edit" | "conflict-resolve";
      createdAt: Date;
    }> = [];
    for (let i = 0; i < 250; i++) {
      rows.push({
        noteId,
        authorId: u.id,
        contentMd: `a${i}`,
        reason: "autosave",
        createdAt: new Date(base - (250 - i) * 1000),
      });
    }
    // Include an ancient manual rev explicitly
    rows.push({
      noteId,
      authorId: u.id,
      contentMd: "m-ancient",
      reason: "manual",
      createdAt: new Date("2023-01-01"),
    });
    for (let i = 1; i < 10; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `m${i}`, reason: "manual", createdAt: new Date(base - i * 500) });
    }
    for (let i = 0; i < 3; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `p${i}`, reason: "pre-ai-edit", createdAt: new Date(base - i * 500) });
    }
    for (let i = 0; i < 2; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `c${i}`, reason: "conflict-resolve", createdAt: new Date(base - i * 500) });
    }
    await db.insert(noteRevisions).values(rows);

    await pruneRevisions(noteId);

    expect(await countByReason(noteId, "autosave")).toBe(200);
    expect(await countByReason(noteId, "manual")).toBe(10);
    expect(await countByReason(noteId, "pre-ai-edit")).toBe(3);
    expect(await countByReason(noteId, "conflict-resolve")).toBe(2);
    const all = await allRevs(noteId);
    expect(all.length).toBe(215);

    const autosaveContents = new Set(all.filter((r) => r.reason === "autosave").map((r) => r.contentMd));
    for (let i = 0; i < 50; i++) {
      expect(autosaveContents.has(`a${i}`)).toBe(false);
    }
    for (let i = 50; i < 250; i++) {
      expect(autosaveContents.has(`a${i}`)).toBe(true);
    }
    // ancient manual is still there
    const manualContents = new Set(all.filter((r) => r.reason === "manual").map((r) => r.contentMd));
    expect(manualContents.has("m-ancient")).toBe(true);
  });

  it("prune scoped to the given note — other notes' revisions are untouched", async () => {
    const noteA = await makeNote();
    const noteB = await makeNote();
    const base = Date.now();
    const mkRows = (noteId: string) =>
      Array.from({ length: 250 }, (_, i) => ({
        noteId,
        authorId: u.id,
        contentMd: `x${i}`,
        reason: "autosave" as const,
        createdAt: new Date(base - (250 - i) * 1000),
      }));
    await db.insert(noteRevisions).values(mkRows(noteA));
    await db.insert(noteRevisions).values(mkRows(noteB));

    await pruneRevisions(noteA);

    expect((await allRevs(noteA)).length).toBe(200);
    expect((await allRevs(noteB)).length).toBe(250);
  });

  it("prune is a no-op when under the cap", async () => {
    const noteId = await makeNote();
    const base = Date.now();
    const rows: Array<{
      noteId: string;
      authorId: string | null;
      contentMd: string;
      reason: "autosave" | "manual" | "pre-ai-edit" | "conflict-resolve";
      createdAt: Date;
    }> = [];
    for (let i = 0; i < 50; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `a${i}`, reason: "autosave", createdAt: new Date(base - (50 - i) * 1000) });
    }
    for (let i = 0; i < 5; i++) {
      rows.push({ noteId, authorId: u.id, contentMd: `m${i}`, reason: "manual", createdAt: new Date(base - i * 100) });
    }
    await db.insert(noteRevisions).values(rows);

    const before = await allRevs(noteId);
    const beforeKey = before
      .map((r) => `${r.id}:${r.createdAt.toISOString()}`)
      .sort();

    await pruneRevisions(noteId);

    const after = await allRevs(noteId);
    const afterKey = after
      .map((r) => `${r.id}:${r.createdAt.toISOString()}`)
      .sort();

    expect(after.length).toBe(55);
    expect(afterKey).toEqual(beforeKey);
  });
});
