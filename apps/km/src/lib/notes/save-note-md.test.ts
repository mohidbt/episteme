// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, libraries } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
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
    await saveNoteMd(noteId, "# Updated");
    const [row] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(row.contentMd).toBe("# Updated");
    // TODO(phase-0.2 follow-up): once we have a DOM-free md→PM JSON converter,
    // assert contentJson is populated here. Tiptap's `new Editor()` throws in
    // Node because it touches `document` during construction, so the server
    // route handler currently catches and persists null.
    expect(row.contentJson).toBeNull();
    expect(row.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });
});
