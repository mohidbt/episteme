// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { internalAuthTestHeaders } from "@/__tests__/internal-auth-headers";
import { eq } from "drizzle-orm";
import { POST } from "./route";

const HMAC_SECRET = "test-notes-publish-secret";
import { POST as POST_LIB } from "../../../libraries/route";
import { POST as POST_NOTE } from "../../route";
import { POST as POST_USERNAME } from "../../../users/username/route";
import { db } from "@/lib/db";
import { notes, user } from "@episteme/db/schema";
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
let otherLibraryId: number;

const rand = () => Math.random().toString(36).slice(2, 8);

async function mkNote(cookie: string, title: string, libId = libraryId) {
  const n = await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie,
      body: JSON.stringify({ libraryId: libId, title }),
    }),
  );
  const row = await n.json();
  return row.id as string;
}

async function clearUsername(userId: string) {
  await db.update(user).set({ username: null }).where(eq(user.id, userId));
}

async function setUsername(cookie: string) {
  const name = `user-${rand()}`;
  const r = await POST_USERNAME(
    req("/api/users/username", {
      method: "POST",
      cookie,
      body: JSON.stringify({ username: name }),
    }),
  );
  expect(r.status).toBe(200);
  return name;
}

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Pub Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
  const r2 = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: other.cookie,
      body: JSON.stringify({ name: "Pub Other Lib" }),
    }),
  );
  otherLibraryId = (await r2.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("POST /api/notes/:id/publish", () => {
  it("401 unauthenticated", async () => {
    const noteId = await mkNote(u.cookie, `Pub No Auth ${rand()}`);
    const r = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        body: JSON.stringify({ isPublic: true, publicSlug: "hello" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(401);
  });

  it("404 when note not owned", async () => {
    const noteId = await mkNote(other.cookie, `Pub Other ${rand()}`, otherLibraryId);
    const r = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: "hello" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(404);
  });

  it("400 when isPublic=true and user has no username", async () => {
    await clearUsername(u.id);
    const noteId = await mkNote(u.cookie, `Pub No Username ${rand()}`);
    const before = await db
      .select({ isPublic: notes.isPublic, publicSlug: notes.publicSlug })
      .from(notes)
      .where(eq(notes.id, noteId));
    const r = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: "hello" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("set_username_first");
    const after = await db
      .select({ isPublic: notes.isPublic, publicSlug: notes.publicSlug })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(after[0].isPublic).toBe(before[0].isPublic);
    expect(after[0].publicSlug).toBe(before[0].publicSlug);
  });

  it("200 when isPublic=true and user has username", async () => {
    await setUsername(u.cookie);
    const noteId = await mkNote(u.cookie, `Pub With Username ${rand()}`);
    const slug = `hello-${rand()}`;
    const r = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: slug }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.isPublic).toBe(true);
    expect(body.publicSlug).toBe(slug);
    const [row] = await db
      .select({ isPublic: notes.isPublic, publicSlug: notes.publicSlug })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(row.isPublic).toBe(true);
    expect(row.publicSlug).toBe(slug);
  });

  it("200 when isPublic=false clears publicSlug", async () => {
    await setUsername(u.cookie);
    const noteId = await mkNote(u.cookie, `Pub Then Unpub ${rand()}`);
    const slug = `pub-unpub-${rand()}`;
    const r1 = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: slug }),
      }),
      params({ id: noteId }),
    );
    expect(r1.status).toBe(200);

    const r2 = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: false }),
      }),
      params({ id: noteId }),
    );
    expect(r2.status).toBe(200);
    const body = await r2.json();
    expect(body.isPublic).toBe(false);
    expect(body.publicSlug).toBeNull();

    const [row] = await db
      .select({ isPublic: notes.isPublic, publicSlug: notes.publicSlug })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(row.isPublic).toBe(false);
    expect(row.publicSlug).toBeNull();
  });

  it("200 when publicSlug omitted and isPublic=true defaults to notes.slug", async () => {
    await setUsername(u.cookie);
    const noteId = await mkNote(u.cookie, `Pub Default Slug ${rand()}`);
    const [noteBefore] = await db
      .select({ slug: notes.slug })
      .from(notes)
      .where(eq(notes.id, noteId));
    const r = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.publicSlug).toBe(noteBefore.slug);
    const [row] = await db
      .select({ publicSlug: notes.publicSlug })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(row.publicSlug).toBe(noteBefore.slug);
  });

  it("400 on malformed publicSlug", async () => {
    await setUsername(u.cookie);
    const noteId = await mkNote(u.cookie, `Pub Bad Slug ${rand()}`);
    const before = await db
      .select({ isPublic: notes.isPublic, publicSlug: notes.publicSlug })
      .from(notes)
      .where(eq(notes.id, noteId));
    const r = await POST(
      req(`/api/notes/${noteId}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: "Hello World" }),
      }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("validation");
    const after = await db
      .select({ isPublic: notes.isPublic, publicSlug: notes.publicSlug })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(after[0].isPublic).toBe(before[0].isPublic);
    expect(after[0].publicSlug).toBe(before[0].publicSlug);
  });

  it("409 on publicSlug conflict within same user", async () => {
    await setUsername(u.cookie);
    const n1 = await mkNote(u.cookie, `Pub Conflict A ${rand()}`);
    const n2 = await mkNote(u.cookie, `Pub Conflict B ${rand()}`);
    const slug = `dup-${rand()}`;
    const r1 = await POST(
      req(`/api/notes/${n1}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: slug }),
      }),
      params({ id: n1 }),
    );
    expect(r1.status).toBe(200);

    const r2 = await POST(
      req(`/api/notes/${n2}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: slug }),
      }),
      params({ id: n2 }),
    );
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toBe("slug_taken");
  });

  it("accepts HMAC-signed request from agent (make_public)", async () => {
    await setUsername(u.cookie);
    const noteId = await mkNote(u.cookie, `Pub HMAC ${rand()}`);
    const slug = `hmac-${rand()}`;
    const path = `/api/notes/${noteId}/publish`;
    const body = JSON.stringify({ isPublic: true, publicSlug: slug });

    const prevSecret = process.env.INHALE_INTERNAL_SECRET;
    process.env.INHALE_INTERNAL_SECRET = HMAC_SECRET;
    try {
      const r = await POST(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...internalAuthTestHeaders({
              secret: HMAC_SECRET,
              userId: u.id,
              method: "POST",
              path,
              body,
            }),
          },
          body,
        }),
        params({ id: noteId }),
      );
      expect(r.status).toBe(200);
      const json = await r.json();
      expect(json.isPublic).toBe(true);
      expect(json.publicSlug).toBe(slug);
    } finally {
      if (prevSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
      else process.env.INHALE_INTERNAL_SECRET = prevSecret;
    }
  });

  it("200 when same slug reused across different users", async () => {
    await setUsername(u.cookie);
    await setUsername(other.cookie);
    const nA = await mkNote(u.cookie, `Pub XU A ${rand()}`);
    const nB = await mkNote(other.cookie, `Pub XU B ${rand()}`, otherLibraryId);
    const slug = `xu-${rand()}`;
    const rA = await POST(
      req(`/api/notes/${nA}/publish`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: slug }),
      }),
      params({ id: nA }),
    );
    expect(rA.status).toBe(200);
    const rB = await POST(
      req(`/api/notes/${nB}/publish`, {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ isPublic: true, publicSlug: slug }),
      }),
      params({ id: nB }),
    );
    expect(rB.status).toBe(200);
  });
});
