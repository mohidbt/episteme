// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PATCH } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import { POST as POST_NOTE } from "../../route";
import { db } from "@/lib/db";
import { notes, noteRevisions } from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let noteId: string;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Content Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
  const n = await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: "Content Note" }),
    }),
  );
  noteId = (await n.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("PATCH /api/notes/:id/content", () => {
  it("401 no cookie", async () => {
    const r = await PATCH(
      req(`/api/notes/${noteId}/content`, {
        method: "PATCH",
        body: JSON.stringify({ contentMd: "x" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(401);
  });

  it("404 cross-user", async () => {
    const r = await PATCH(
      req(`/api/notes/${noteId}/content`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ contentMd: "x" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(404);
  });

  it("400 invalid body (missing contentMd)", async () => {
    const r = await PATCH(
      req(`/api/notes/${noteId}/content`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({}),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });

  it("204 success and persists contentMd", async () => {
    const md = "# Hello\n\nBody text.";
    const r = await PATCH(
      req(`/api/notes/${noteId}/content`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ contentMd: md }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    const [row] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(row.contentMd).toBe(md);
    // TODO(phase-0.2 follow-up): assert contentJson non-null once a DOM-free
    // md→PM JSON converter replaces Tiptap on the server. See saveNoteMd.
    expect(row.contentJson).toBeNull();
  });

  it("defaults to autosave reason", async () => {
    // Insert directly (not via POST_NOTE) to avoid the seeded manual revision,
    // so the autosave branch's "no prior revs → age=Infinity" triggers insert.
    const [seed] = await db
      .insert(notes)
      .values({
        userId: u.id,
        libraryId,
        title: "Autosave Default Note",
        slug: `autosave-default-${Date.now()}`,
      })
      .returning();
    const autosaveNoteId = seed.id;
    const r = await PATCH(
      req(`/api/notes/${autosaveNoteId}/content`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ contentMd: "autosave body" }),
      }),
      params({ id: autosaveNoteId }),
    );
    expect(r.status).toBe(204);
    const revs = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, autosaveNoteId));
    expect(revs.length).toBe(1);
    expect(revs[0].reason).toBe("autosave");
  });

  it("?reason=manual creates a manual revision", async () => {
    const n = await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, title: "Manual Reason Note" }),
      }),
    );
    const manualNoteId = (await n.json()).id;
    const r = await PATCH(
      req(`/api/notes/${manualNoteId}/content?reason=manual`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ contentMd: "manual body" }),
      }),
      params({ id: manualNoteId }),
    );
    expect(r.status).toBe(204);
    const revs = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, manualNoteId));
    const fromPatch = revs.find((r) => r.contentMd === "manual body");
    expect(fromPatch?.reason).toBe("manual");
  });

  it("rejects invalid ?reason=garbage with 400 validation", async () => {
    const r = await PATCH(
      req(`/api/notes/${noteId}/content?reason=garbage`, {
        method: "PATCH",
        cookie: u.cookie,
        body: JSON.stringify({ contentMd: "x" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });
});
