// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST } from "./route";
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

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Snapshot Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("POST /api/notes/:id/revisions/snapshot", () => {
  it("401 when unauthenticated", async () => {
    const noteId = await mkNote(u.cookie, "Snapshot no auth");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot?reason=pre-ai-edit`, {
        method: "POST",
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(401);
  });

  it("404 when note owned by another user", async () => {
    const noteId = await mkNote(u.cookie, "Snapshot other user");
    const before = await db
      .select({ id: noteRevisions.id })
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId));
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot?reason=pre-ai-edit`, {
        method: "POST",
        cookie: other.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(404);
    const after = await db
      .select({ id: noteRevisions.id })
      .from(noteRevisions)
      .where(eq(noteRevisions.noteId, noteId));
    expect(after.length).toBe(before.length);
  });

  it("?reason=pre-ai-edit creates a pre-ai-edit revision from current notes.contentMd", async () => {
    const noteId = await mkNote(u.cookie, "Snapshot pre-ai", "snapshot target");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot?reason=pre-ai-edit`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as {
      id: string;
      createdAt: string;
      reason: string;
    };
    expect(body.reason).toBe("pre-ai-edit");
    expect(typeof body.id).toBe("string");
    expect(typeof body.createdAt).toBe("string");

    const [inserted] = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.id, body.id));
    expect(inserted.contentMd).toBe("snapshot target");
    expect(inserted.reason).toBe("pre-ai-edit");
    expect(inserted.noteId).toBe(noteId);
  });

  it("?reason=conflict-resolve creates a conflict-resolve revision", async () => {
    const noteId = await mkNote(
      u.cookie,
      "Snapshot conflict",
      "conflict target",
    );
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot?reason=conflict-resolve`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { id: string; reason: string };
    expect(body.reason).toBe("conflict-resolve");
    const [inserted] = await db
      .select()
      .from(noteRevisions)
      .where(eq(noteRevisions.id, body.id));
    expect(inserted.contentMd).toBe("conflict target");
    expect(inserted.reason).toBe("conflict-resolve");
  });

  it("?reason=manual → 400", async () => {
    const noteId = await mkNote(u.cookie, "Snapshot manual reject");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot?reason=manual`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });

  it("?reason=autosave → 400", async () => {
    const noteId = await mkNote(u.cookie, "Snapshot autosave reject");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot?reason=autosave`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });

  it("?reason=garbage → 400", async () => {
    const noteId = await mkNote(u.cookie, "Snapshot garbage reject");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot?reason=garbage`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });

  it("missing ?reason → 400", async () => {
    const noteId = await mkNote(u.cookie, "Snapshot missing reason");
    const r = await POST(
      req(`/api/notes/${noteId}/revisions/snapshot`, {
        method: "POST",
        cookie: u.cookie,
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
  });
});
