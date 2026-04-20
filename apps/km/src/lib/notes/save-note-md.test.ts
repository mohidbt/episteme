// @vitest-environment jsdom
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
  it("updates contentMd, contentJson, and bumps updatedAt", async () => {
    await saveNoteMd(noteId, "# Updated");
    const [row] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(row.contentMd).toBe("# Updated");
    expect(row.contentJson).not.toBeNull();
    const json = row.contentJson as { type: string };
    expect(json.type).toBe("doc");
    expect(row.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });
});
