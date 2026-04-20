// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PATCH } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import { POST as POST_NOTE } from "../../route";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
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
    const [row] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(row.contentMd).toBe(md);
    expect(row.contentJson).not.toBeNull();
  });
});
