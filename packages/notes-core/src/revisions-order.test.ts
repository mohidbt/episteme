// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@episteme/db";
import { libraries, noteRevisions, notes } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "./_test-utils";

let u: TestUser;
let noteId: string;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Revisions Order Lib" })
    .returning();
  const [note] = await db
    .insert(notes)
    .values({
      userId: u.id,
      libraryId: lib.id,
      title: "Revisions Order Note",
      slug: `rev-order-${Date.now()}`,
      contentMd: "initial",
    })
    .returning();
  noteId = note.id;

  // Insert two revisions with IDENTICAL createdAt. Without a stable tiebreaker,
  // ordering by createdAt alone is non-deterministic; ordering by (createdAt
  // DESC, id DESC) locks it.
  const sameTs = new Date();
  await db.insert(noteRevisions).values([
    {
      noteId,
      authorId: u.id,
      contentMd: "A",
      reason: "autosave",
      createdAt: sameTs,
    },
    {
      noteId,
      authorId: u.id,
      contentMd: "B",
      reason: "autosave",
      createdAt: sameTs,
    },
  ]);
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("note_revisions stable ordering", () => {
  it("orderBy (createdAt DESC, id DESC) is stable across re-queries for same-timestamp rows", async () => {
    const q1 = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId))
      .orderBy(desc(noteRevisions.createdAt), desc(noteRevisions.id));
    const q2 = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId))
      .orderBy(desc(noteRevisions.createdAt), desc(noteRevisions.id));

    expect(q1.map((r) => r.id)).toEqual(q2.map((r) => r.id));
    expect(q1.length).toBe(2);
  });

  it("composite index (note_id, created_at DESC, id DESC) exists on note_revisions", async () => {
    const result = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'note_revisions'
        AND indexdef ILIKE '%note_id%created_at%id%'
    `);
    // postgres-js returns an array-like of rows
    const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
  });
});
