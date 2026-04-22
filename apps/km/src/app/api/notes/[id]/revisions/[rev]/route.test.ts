// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { GET } from "./route";
import { POST as RESTORE } from "./restore/route";
import { POST as POST_LIB } from "../../../../libraries/route";
import { POST as POST_NOTE } from "../../../route";
import { db } from "@/lib/db";
import { notes, noteRevisions } from "@episteme/db/schema";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

async function mkNote(cookie: string, title: string, contentMd?: string) {
  const n = await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie,
      body: JSON.stringify({ libraryId, title }),
    }),
  );
  const row = await n.json();
  if (contentMd !== undefined) {
    await db.update(notes).set({ contentMd }).where(eq(notes.id, row.id));
  }
  return row.id as string;
}

async function mkRev(noteId: string, contentMd: string) {
  const [r] = await db
    .insert(noteRevisions)
    .values({ noteId, authorId: u.id, contentMd, reason: "manual" })
    .returning();
  return r;
}

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Rev Body Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/notes/:id/revisions/:rev", () => {
  it("200 returns { contentMd }", async () => {
    const noteId = await mkNote(u.cookie, "Get rev body");
    const rev = await mkRev(noteId, "snapshot content");
    const r = await GET(
      req(`/api/notes/${noteId}/revisions/${rev.id}`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ contentMd: "snapshot content" });
  });

  it("404 if rev doesn't exist", async () => {
    const noteId = await mkNote(u.cookie, "Get rev missing");
    const r = await GET(
      req(`/api/notes/${noteId}/revisions/00000000-0000-0000-0000-000000000000`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: noteId, rev: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(r.status).toBe(404);
  });

  it("404 if rev.noteId !== :id (cross-note)", async () => {
    const noteA = await mkNote(u.cookie, "Rev cross note A");
    const noteB = await mkNote(u.cookie, "Rev cross note B");
    const rev = await mkRev(noteB, "belongs to B");
    const r = await GET(
      req(`/api/notes/${noteA}/revisions/${rev.id}`, {
        method: "GET",
        cookie: u.cookie,
      }),
      params({ id: noteA, rev: rev.id }),
    );
    expect(r.status).toBe(404);
  });

  it("404 if note not owned by user", async () => {
    const noteId = await mkNote(u.cookie, "Rev not owned");
    const rev = await mkRev(noteId, "secret");
    const r = await GET(
      req(`/api/notes/${noteId}/revisions/${rev.id}`, {
        method: "GET",
        cookie: other.cookie,
      }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(404);
  });

  it("401 when unauthenticated", async () => {
    const noteId = await mkNote(u.cookie, "Rev no auth");
    const rev = await mkRev(noteId, "unauth");
    const r = await GET(
      req(`/api/notes/${noteId}/revisions/${rev.id}`, { method: "GET" }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(401);
  });
});

describe("POST /api/notes/:id/revisions/:rev/restore", () => {
  it("204 on success", async () => {
    const noteId = await mkNote(u.cookie, "Restore 204", "current");
    const rev = await mkRev(noteId, "old snapshot");
    const r = await RESTORE(
      req(`/api/notes/${noteId}/revisions/${rev.id}/restore`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
  });

  it("restored contentMd becomes notes.contentMd", async () => {
    const noteId = await mkNote(u.cookie, "Restore content", "current body");
    const rev = await mkRev(noteId, "restored body v1");
    const r = await RESTORE(
      req(`/api/notes/${noteId}/revisions/${rev.id}/restore`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(204);
    const [n] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(n.contentMd).toBe("restored body v1");
  });

  it("appends a new manual revision with the restored content", async () => {
    const noteId = await mkNote(u.cookie, "Restore appends rev", "current xyz");
    const rev = await mkRev(noteId, "restore target body");
    const before = await db
      .select({ id: noteRevisions.id })
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId));
    const r = await RESTORE(
      req(`/api/notes/${noteId}/revisions/${rev.id}/restore`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(204);
    const after = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId))
      .orderBy(desc(noteRevisions.createdAt), desc(noteRevisions.id));
    expect(after.length).toBe(before.length + 1);
    const newest = after[0];
    expect(newest.reason).toBe("manual");
    expect(newest.contentMd).toBe("restore target body");
  });

  it("404 if rev doesn't exist", async () => {
    const noteId = await mkNote(u.cookie, "Restore missing rev");
    const r = await RESTORE(
      req(`/api/notes/${noteId}/revisions/00000000-0000-0000-0000-000000000000/restore`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId, rev: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(r.status).toBe(404);
  });

  it("404 if rev belongs to a different note", async () => {
    const a = await mkNote(u.cookie, "Restore cross A");
    const b = await mkNote(u.cookie, "Restore cross B");
    const rev = await mkRev(b, "belongs to B");
    const r = await RESTORE(
      req(`/api/notes/${a}/revisions/${rev.id}/restore`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: a, rev: rev.id }),
    );
    expect(r.status).toBe(404);
  });

  it("404 if note not owned", async () => {
    const noteId = await mkNote(u.cookie, "Restore not owned");
    const rev = await mkRev(noteId, "secret");
    const r = await RESTORE(
      req(`/api/notes/${noteId}/revisions/${rev.id}/restore`, {
        method: "POST",
        cookie: other.cookie,
      }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(404);
  });

  it("401 when unauthenticated", async () => {
    const noteId = await mkNote(u.cookie, "Restore no auth");
    const rev = await mkRev(noteId, "unauth");
    const r = await RESTORE(
      req(`/api/notes/${noteId}/revisions/${rev.id}/restore`, {
        method: "POST",
      }),
      params({ id: noteId, rev: rev.id }),
    );
    expect(r.status).toBe(401);
  });
});
