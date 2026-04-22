// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, noteRevisions, libraries } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";

vi.mock("@/lib/ai/embed-on-save", () => ({
  embedOnSave: vi.fn(() => new Promise(() => {})),
}));

import { embedOnSave } from "@/lib/ai/embed-on-save";
import { saveNoteMd } from "./save-note-md";

let u: TestUser;
let libraryId: number;
let noteId: string;
let originalUpdatedAt: Date;

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db
    .insert(libraries)
    .values({ userId: u.id, name: "Save Lib" })
    .returning();
  libraryId = lib.id;
  const [note] = await db
    .insert(notes)
    .values({
      userId: u.id,
      libraryId,
      title: "Save Note",
      slug: `save-note-${Date.now()}`,
      contentMd: "initial",
    })
    .returning();
  noteId = note.id;
  originalUpdatedAt = note.updatedAt;
  // ensure a clock tick before update
  await new Promise((r) => setTimeout(r, 20));
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("saveNoteMd", () => {
  it("updates contentMd and bumps updatedAt in Node runtime (contentJson null until DOM-free converter lands)", async () => {
    await saveNoteMd(noteId, "# Updated", u.id);
    const [row] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(row.contentMd).toBe("# Updated");
    // TODO(phase-0.2 follow-up): once we have a DOM-free md→PM JSON converter,
    // assert contentJson is populated here. Tiptap's `new Editor()` throws in
    // Node because it touches `document` during construction, so the server
    // route handler currently catches and persists null.
    expect(row.contentJson).toBeNull();
    expect(row.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it("with reason=manual creates a note_revisions row with the new content", async () => {
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u.id, name: "Manual Rev Lib" })
      .returning();
    const [note] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId: lib.id,
        title: "Manual Rev",
        slug: `manual-rev-${Date.now()}`,
        contentMd: "initial",
      })
      .returning();
    const before = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, note.id));
    expect(before.length).toBe(0);

    await saveNoteMd(note.id, "new content", u.id, "manual");

    const after = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, note.id));
    expect(after.length).toBe(1);
    expect(after[0].contentMd).toBe("new content");
    expect(after[0].reason).toBe("manual");
    expect(after[0].authorId).toBe(u.id);
    expect(after[0].noteId).toBe(note.id);
  });

  it("with reason=autosave and tiny delta and no prior revision inserts a row", async () => {
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u.id, name: "Autosave Lib" })
      .returning();
    const [note] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId: lib.id,
        title: "Autosave Note",
        slug: `autosave-${Date.now()}`,
        contentMd: "xx",
      })
      .returning();

    await saveNoteMd(note.id, "xy", u.id, "autosave");

    const rows = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, note.id));
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe("autosave");
    expect(rows[0].contentMd).toBe("xy");
  });

  it("defaults to autosave when reason omitted", async () => {
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u.id, name: "Default Lib" })
      .returning();
    const [note] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId: lib.id,
        title: "Default Note",
        slug: `default-${Date.now()}`,
        contentMd: "a",
      })
      .returning();

    await saveNoteMd(note.id, "b", u.id);

    const rows = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, note.id));
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe("autosave");
  });

  it("saveNoteMd autosave with large delta creates a revision even when a recent revision exists", async () => {
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u.id, name: "Delta Lib" })
      .returning();
    const [note] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId: lib.id,
        title: "delta-test",
        slug: `delta-test-${Date.now()}`,
        contentMd: "short",
      })
      .returning();

    // seed a recent revision (1 min ago) so age gate does NOT fire
    await db.insert(noteRevisions).values({
      noteId: note.id,
      authorId: u.id,
      contentMd: "short",
      reason: "manual",
      createdAt: new Date(Date.now() - 60_000),
    });

    // large-delta autosave — delta = |5 - 105| = 100, > 50
    const bigMd = "short" + "x".repeat(100);
    await saveNoteMd(note.id, bigMd, u.id, "autosave");

    const rows = await db.select().from(noteRevisions).where(eq(noteRevisions.noteId, note.id));
    const autosaveRows = rows.filter((r) => r.reason === "autosave");
    expect(autosaveRows).toHaveLength(1);
    expect(autosaveRows[0].contentMd).toBe(bigMd);
  });

  it("kicks off embedOnSave but does not await it", async () => {
    vi.mocked(embedOnSave).mockClear();
    vi.mocked(embedOnSave).mockImplementation(() => new Promise(() => {}));
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u.id, name: "Embed Dispatch Lib" })
      .returning();
    const [note] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId: lib.id,
        title: "Embed Dispatch",
        slug: `embed-dispatch-${Date.now()}`,
        contentMd: "old",
      })
      .returning();

    const start = Date.now();
    await saveNoteMd(note.id, "new body", u.id, "manual");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(embedOnSave).toHaveBeenCalledTimes(1);
    expect(embedOnSave).toHaveBeenCalledWith(note.id, "new body", u.id);
  });

  it("resolves even if embedOnSave throws synchronously", async () => {
    vi.mocked(embedOnSave).mockClear();
    vi.mocked(embedOnSave).mockImplementation(() => {
      throw new Error("sync boom");
    });
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u.id, name: "Embed Throw Lib" })
      .returning();
    const [note] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId: lib.id,
        title: "Embed Throw",
        slug: `embed-throw-${Date.now()}`,
        contentMd: "x",
      })
      .returning();

    await expect(saveNoteMd(note.id, "y", u.id, "manual")).resolves.toBeUndefined();
    expect(embedOnSave).toHaveBeenCalledTimes(1);
  });

  it("snapshot reflects the updated notes.content_md", async () => {
    const [lib] = await db
      .insert(libraries)
      .values({ userId: u.id, name: "Snapshot Lib" })
      .returning();
    const [note] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId: lib.id,
        title: "Snapshot Note",
        slug: `snapshot-${Date.now()}`,
        contentMd: "old",
      })
      .returning();

    await saveNoteMd(note.id, "brand new body", u.id, "manual");

    const [row] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect(row.contentMd).toBe("brand new body");
    const [latest] = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, note.id))
      .orderBy(desc(noteRevisions.createdAt))
      .limit(1);
    expect(latest.contentMd).toBe("brand new body");
  });
});
