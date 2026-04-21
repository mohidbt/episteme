// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { libraries, notes, noteTags } from "@episteme/db/schema";
import { createTestUser, deleteTestUser, type TestUser } from "@/app/api/_test-utils";
import { listTagsWithCounts, listNotesByTag } from "./tag-queries";

let u: TestUser;
let libraryId: number;
let noteAId: string;
let noteBId: string;

async function insertNote(opts: {
  userId: string;
  libraryId: number;
  title: string;
  slug: string;
}): Promise<string> {
  const [row] = await db
    .insert(notes)
    .values({ userId: opts.userId, libraryId: opts.libraryId, title: opts.title, slug: opts.slug, contentMd: "" })
    .returning({ id: notes.id });
  return row.id;
}

async function insertTag(noteId: string, tag: string) {
  await db.insert(noteTags).values({ noteId, tag });
}

beforeAll(async () => {
  u = await createTestUser();
  const [lib] = await db.insert(libraries).values({ userId: u.id, name: "Tags Test Lib" }).returning();
  libraryId = lib.id;

  noteAId = await insertNote({ userId: u.id, libraryId, title: "Note A", slug: `note-a-${Date.now()}` });
  noteBId = await insertNote({ userId: u.id, libraryId, title: "Note B", slug: `note-b-${Date.now()}` });

  // Both notes share tag "ml"; only noteA has "deep"
  await insertTag(noteAId, "ml");
  await insertTag(noteBId, "ml");
  await insertTag(noteAId, "deep");
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

describe("listTagsWithCounts", () => {
  it("returns empty array for a user with no tags", async () => {
    const v = await createTestUser();
    try {
      const rows = await listTagsWithCounts(v.id);
      expect(rows).toEqual([]);
    } finally {
      await deleteTestUser(v.id);
    }
  });

  it("returns correct tag counts for the user", async () => {
    const rows = await listTagsWithCounts(u.id);
    // Should have 2 tags: "deep" (count 1) and "ml" (count 2), alphabetically
    expect(rows.map((r) => r.tag)).toEqual(["deep", "ml"]);
    const byTag = Object.fromEntries(rows.map((r) => [r.tag, r.count]));
    expect(byTag.ml).toBe(2);
    expect(byTag.deep).toBe(1);
  });

  it("does not include another user's tags", async () => {
    const v = await createTestUser();
    try {
      const [vLib] = await db.insert(libraries).values({ userId: v.id, name: "V Lib" }).returning();
      const vNoteId = await insertNote({ userId: v.id, libraryId: vLib.id, title: "V Note", slug: `vnote-${Date.now()}` });
      await insertTag(vNoteId, "xtag");

      const rows = await listTagsWithCounts(u.id);
      expect(rows.find((r) => r.tag === "xtag")).toBeUndefined();
    } finally {
      await deleteTestUser(v.id);
    }
  });
});

describe("listNotesByTag", () => {
  it("returns empty array when no notes have the tag", async () => {
    const rows = await listNotesByTag(u.id, "nonexistent");
    expect(rows).toEqual([]);
  });

  it("returns only notes tagged with the given tag for the user", async () => {
    const rows = await listNotesByTag(u.id, "ml");
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(["Note A", "Note B"]);
  });

  it("returns only the specific tag's notes (deep has only noteA)", async () => {
    const rows = await listNotesByTag(u.id, "deep");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Note A");
  });

  it("does not return another user's notes for the same tag", async () => {
    const v = await createTestUser();
    try {
      const [vLib] = await db.insert(libraries).values({ userId: v.id, name: "V Lib" }).returning();
      const vNoteId = await insertNote({ userId: v.id, libraryId: vLib.id, title: "V Note", slug: `vnote2-${Date.now()}` });
      await insertTag(vNoteId, "ml");

      const rows = await listNotesByTag(u.id, "ml");
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(vNoteId);
    } finally {
      await deleteTestUser(v.id);
    }
  });
});
