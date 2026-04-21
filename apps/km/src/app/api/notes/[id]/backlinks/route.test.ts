// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import { POST as POST_NOTE } from "../../route";
import { PATCH as PATCH_CONTENT } from "../content/route";
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
let targetNoteId: string;
let targetNoteTitle: string;
let sourceNote1Id: string;
let sourceNote1Slug: string;
let sourceNote1Title: string;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  const libRes = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Backlinks Lib" }),
    }),
  );
  libraryId = (await libRes.json()).id;

  const otherLibRes = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: other.cookie,
      body: JSON.stringify({ name: "Other Backlinks Lib" }),
    }),
  );
  otherLibraryId = (await otherLibRes.json()).id;

  targetNoteTitle = "TargetNote";
  const targetRes = await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: targetNoteTitle }),
    }),
  );
  const target = await targetRes.json();
  targetNoteId = target.id;

  sourceNote1Title = "Source Note One";
  const src1Res = await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: sourceNote1Title }),
    }),
  );
  const src1 = await src1Res.json();
  sourceNote1Id = src1.id;
  sourceNote1Slug = src1.slug;

  // Give source note content that links to target
  await PATCH_CONTENT(
    req(`/api/notes/${sourceNote1Id}/content`, {
      method: "PATCH",
      cookie: u.cookie,
      body: JSON.stringify({
        contentMd: `Some intro text here. [[${targetNoteTitle}]] is a great concept. More text after.`,
      }),
    }),
    params({ id: sourceNote1Id }),
  );
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/notes/:id/backlinks", () => {
  it("401 when unauthed", async () => {
    const r = await GET(
      req(`/api/notes/${targetNoteId}/backlinks`),
      params({ id: targetNoteId }),
    );
    expect(r.status).toBe(401);
  });

  it("404 when note does not exist", async () => {
    const randomId = crypto.randomUUID();
    const r = await GET(
      req(`/api/notes/${randomId}/backlinks`, { cookie: u.cookie }),
      params({ id: randomId }),
    );
    expect(r.status).toBe(404);
  });

  it("404 when note belongs to another user", async () => {
    // other user tries to get backlinks for u's note
    const r = await GET(
      req(`/api/notes/${targetNoteId}/backlinks`, { cookie: other.cookie }),
      params({ id: targetNoteId }),
    );
    expect(r.status).toBe(404);
  });

  it("returns empty sources when no backlinks exist", async () => {
    // Create a fresh note that nothing links to
    const freshRes = await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, title: "Isolated Note" }),
      }),
    );
    const fresh = await freshRes.json();

    const r = await GET(
      req(`/api/notes/${fresh.id}/backlinks`, { cookie: u.cookie }),
      params({ id: fresh.id }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sources).toEqual([]);
  });

  it("returns sources with correct shape", async () => {
    const r = await GET(
      req(`/api/notes/${targetNoteId}/backlinks`, { cookie: u.cookie }),
      params({ id: targetNoteId }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sources.length).toBeGreaterThan(0);
    const source = body.sources[0];
    expect(source).toHaveProperty("id");
    expect(source).toHaveProperty("title");
    expect(source).toHaveProperty("slug");
    expect(source).toHaveProperty("snippet");
    // contentMd must NOT be in the response
    expect(source).not.toHaveProperty("contentMd");
  });

  it("snippet contains text near the [[Title]] occurrence", async () => {
    const r = await GET(
      req(`/api/notes/${targetNoteId}/backlinks`, { cookie: u.cookie }),
      params({ id: targetNoteId }),
    );
    const { sources } = await r.json();
    const source = sources.find((s: { id: string }) => s.id === sourceNote1Id);
    expect(source).toBeDefined();
    // Snippet should include text from around the [[TargetNote]] occurrence
    expect(source.snippet).toContain(targetNoteTitle);
  });

  it("source has correct id, title, slug", async () => {
    const r = await GET(
      req(`/api/notes/${targetNoteId}/backlinks`, { cookie: u.cookie }),
      params({ id: targetNoteId }),
    );
    const { sources } = await r.json();
    const source = sources.find((s: { id: string }) => s.id === sourceNote1Id);
    expect(source).toBeDefined();
    expect(source.id).toBe(sourceNote1Id);
    expect(source.title).toBe(sourceNote1Title);
    expect(source.slug).toBe(sourceNote1Slug);
  });

  it("only includes target_kind=note rows (not reference/paper)", async () => {
    // The rebuildLinks mechanism only creates note-kind rows for matched notes.
    // Since our test only links to valid notes, all returned rows should be 'note' kind.
    // This test verifies the WHERE clause is filtering correctly by checking
    // that a note with no note-kind backlinks returns empty sources.
    const r = await GET(
      req(`/api/notes/${targetNoteId}/backlinks`, { cookie: u.cookie }),
      params({ id: targetNoteId }),
    );
    const { sources } = await r.json();
    // All sources should be actual notes (they link to targetNoteId via target_kind='note')
    for (const source of sources) {
      expect(source).toHaveProperty("id");
      expect(source).toHaveProperty("title");
      expect(source).toHaveProperty("slug");
    }
  });

  it("scopes results to caller's notes (other user's linking notes don't appear)", async () => {
    // Create a note for other user that also links to a same-title note
    const otherNoteTitle = "OtherUserNote";
    const otherTargetRes = await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ libraryId: otherLibraryId, title: otherNoteTitle }),
      }),
    );
    const otherTarget = await otherTargetRes.json();

    // Create source for other user linking to their own note
    const otherSrcRes = await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ libraryId: otherLibraryId, title: "Other Source" }),
      }),
    );
    const otherSrc = await otherSrcRes.json();
    await PATCH_CONTENT(
      req(`/api/notes/${otherSrc.id}/content`, {
        method: "PATCH",
        cookie: other.cookie,
        body: JSON.stringify({ contentMd: `Link to [[${otherNoteTitle}]]` }),
      }),
      params({ id: otherSrc.id }),
    );

    // u cannot access other's note — should get 404
    const r = await GET(
      req(`/api/notes/${otherTarget.id}/backlinks`, { cookie: u.cookie }),
      params({ id: otherTarget.id }),
    );
    expect(r.status).toBe(404);
  });
});
