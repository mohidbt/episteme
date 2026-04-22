// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, noteRevisions, notes } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { createRevisionIfNeeded } from "./create-revision";

let u: TestUser;
let libraryId: number;

async function makeNote(contentMd: string): Promise<string> {
  const [note] = await db
    .insert(notes)
    .values({
      userId: u.id,
      libraryId,
      title: "Rev Note",
      slug: `rev-note-${Math.random().toString(36).slice(2)}-${Date.now()}`,
      contentMd,
    })
    .returning();
  return note.id;
}

async function countRevs(noteId: string): Promise<number> {
  const rows = await db
    .select({ id: noteRevisions.id })
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, noteId));
  return rows.length;
}

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Rev Lib" })
    .returning();
  libraryId = lib.id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("createRevisionIfNeeded", () => {
  it("autosave below delta threshold does NOT create a row when recent", async () => {
    const noteId = await makeNote("hello");
    // Seed a revision 1 minute ago
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 60 * 1000),
    });
    const before = await countRevs(noteId);
    expect(before).toBe(1);

    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd: "hella", // delta = 0 (same length)
      reason: "autosave",
    });

    const after = await countRevs(noteId);
    expect(after).toBe(1);
  });

  it("autosave above delta threshold creates a row", async () => {
    const noteId = await makeNote("hello");
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 60 * 1000),
    });
    const newMd = "hello " + "x".repeat(60); // delta > 50
    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd,
      reason: "autosave",
    });

    const rows = await db
      .select()
      .from(noteRevisions)
      .where(and(eq(noteRevisions.noteId, noteId), eq(noteRevisions.contentMd, newMd)));
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe("autosave");
  });

  it("manual always creates a row regardless of delta", async () => {
    const noteId = await makeNote("hello");
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 10 * 1000),
    });
    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd: "hella",
      reason: "manual",
    });
    const rows = await db
      .select()
      .from(noteRevisions)
      .where(and(eq(noteRevisions.noteId, noteId), eq(noteRevisions.reason, "manual")));
    expect(rows.length).toBe(1);
  });

  it("pre-ai-edit always creates a row regardless of delta", async () => {
    const noteId = await makeNote("hello");
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 10 * 1000),
    });
    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd: "hella",
      reason: "pre-ai-edit",
    });
    const rows = await db
      .select()
      .from(noteRevisions)
      .where(and(eq(noteRevisions.noteId, noteId), eq(noteRevisions.reason, "pre-ai-edit")));
    expect(rows.length).toBe(1);
  });

  it("autosave after 5+ minutes forces a row even with tiny delta", async () => {
    const noteId = await makeNote("hello");
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    const before = await countRevs(noteId);
    expect(before).toBe(1);

    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd: "hella",
      reason: "autosave",
    });
    const after = await countRevs(noteId);
    expect(after).toBe(2);
  });

  it("autosave with delta exactly 50 and recent last revision does NOT create a row", async () => {
    const noteId = await makeNote("a".repeat(10));
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "a".repeat(10),
      reason: "autosave",
      createdAt: new Date(Date.now() - 60 * 1000),
    });
    const before = await countRevs(noteId);
    expect(before).toBe(1);

    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd: "a".repeat(60), // delta exactly 50
      reason: "autosave",
    });

    const after = await countRevs(noteId);
    expect(after).toBe(1);
  });

  it("autosave with age exactly 5min and tiny delta does NOT create a row", async () => {
    const noteId = await makeNote("hello");
    const seedAt = new Date(Date.now() - 5 * 60 * 1000);
    await db.insert(noteRevisions).values({
      noteId,
      authorId: u.id,
      contentMd: "hello",
      reason: "autosave",
      createdAt: seedAt,
    });
    const before = await countRevs(noteId);
    expect(before).toBe(1);

    // Freeze Date only (not setTimeout) so DB driver timers keep working.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(seedAt.getTime() + 5 * 60 * 1000);
    try {
      await createRevisionIfNeeded({
        noteId,
        authorId: u.id,
        newMd: "hella", // tiny delta
        reason: "autosave",
      });
    } finally {
      vi.useRealTimers();
    }

    const after = await countRevs(noteId);
    expect(after).toBe(1);
  });

  it("autosave with no prior revisions creates a row", async () => {
    const noteId = await makeNote("hello");
    expect(await countRevs(noteId)).toBe(0);

    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd: "hella",
      reason: "autosave",
    });
    expect(await countRevs(noteId)).toBe(1);
  });

  it("createRevisionIfNeeded calls pruneRevisions on autosave insert", async () => {
    const noteId = await makeNote("seed");
    const base = Date.now();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      noteId,
      authorId: u.id,
      contentMd: `a${i}`,
      reason: "autosave" as const,
      createdAt: new Date(base - (250 - i) * 1000),
    }));
    await db.insert(noteRevisions).values(rows);
    expect(await countRevs(noteId)).toBe(250);

    // New autosave with delta > 50 to force an insert
    const newMd = "seed" + "x".repeat(100);
    await createRevisionIfNeeded({
      noteId,
      authorId: u.id,
      newMd,
      reason: "autosave",
    });

    // 250 existing + 1 new = 251, prune keeps latest 200 → 200
    const autosaveRows = await db
      .select({ id: noteRevisions.id })
      .from(noteRevisions)
      .where(and(eq(noteRevisions.noteId, noteId), eq(noteRevisions.reason, "autosave")));
    expect(autosaveRows.length).toBe(200);
  });
});
