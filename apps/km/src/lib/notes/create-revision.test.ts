// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
