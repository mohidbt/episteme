import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import {
  DELETE as DEL_ID,
  GET as GET_ID,
  PATCH as PATCH_ID,
} from "./[id]/route";
import {
  GET as GET_LINKS,
  POST as POST_LINK,
} from "./[id]/links/route";
import { DELETE as DEL_LINK } from "./[id]/links/[linkId]/route";
import { POST as POST_LIB } from "../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
  type TestUser,
} from "../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Notes Lib" }) }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

const noteBody = (overrides: Record<string, unknown> = {}) => ({
  libraryId,
  title: "Hello World",
  ...overrides,
});

describe("notes", () => {
  it("401 no user", async () => {
    const r = await GET(req(`/api/notes?libraryId=${libraryId}`));
    expect(r.status).toBe(401);
  });

  it("400 missing title", async () => {
    const r = await POST(
      req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify({ libraryId }) }),
    );
    expect(r.status).toBe(400);
  });

  it("creates with slug from title", async () => {
    const c = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody()) }));
    expect(c.status).toBe(201);
    const note = await c.json();
    expect(note.slug).toBe("hello-world");

    await DEL_ID(req(`/api/notes/${note.id}`, { method: "DELETE", cookie: u.cookie }), params({ id: note.id }));
  });

  it("slug collision yields -2, -3", async () => {
    const a = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "Dup Note" })) }));
    const b = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "Dup Note" })) }));
    const c = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "Dup Note" })) }));
    const aJ = await a.json(), bJ = await b.json(), cJ = await c.json();
    expect(aJ.slug).toBe("dup-note");
    expect(bJ.slug).toBe("dup-note-2");
    expect(cJ.slug).toBe("dup-note-3");
  });

  it("PATCH title updates slug with collision handling, excluding self", async () => {
    const create = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "Original Title" })) }));
    const note = await create.json();
    const noChange = await PATCH_ID(
      req(`/api/notes/${note.id}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ title: "Original Title" }) }),
      params({ id: note.id }),
    );
    expect((await noChange.json()).slug).toBe("original-title");

    const changed = await PATCH_ID(
      req(`/api/notes/${note.id}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ title: "Brand New" }) }),
      params({ id: note.id }),
    );
    expect((await changed.json()).slug).toBe("brand-new");
  });

  it("PATCH with unchanged title keeps slug (no -2 suffix)", async () => {
    const create = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "My Note" })) }));
    const note = await create.json();
    expect(note.slug).toBe("my-note");

    const patched = await PATCH_ID(
      req(`/api/notes/${note.id}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ title: "My Note" }) }),
      params({ id: note.id }),
    );
    const patchedJson = await patched.json();
    expect(patchedJson.slug).toBe("my-note");
  });

  it("PATCH to title matching another note's title produces -2 slug", async () => {
    const occupy = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "Shared Title" })) }));
    expect((await occupy.json()).slug).toBe("shared-title");

    const other2 = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "Other Title" })) }));
    const otherNote = await other2.json();
    expect(otherNote.slug).toBe("other-title");

    const patched = await PATCH_ID(
      req(`/api/notes/${otherNote.id}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ title: "Shared Title" }) }),
      params({ id: otherNote.id }),
    );
    expect((await patched.json()).slug).toBe("shared-title-2");
  });

  it("golden path CRUD + ownership", async () => {
    const c = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "CRUD Note" })) }));
    const note = await c.json();

    const one = await GET_ID(req(`/api/notes/${note.id}`, { cookie: u.cookie }), params({ id: note.id }));
    expect(one.status).toBe(200);

    const foreignPatch = await PATCH_ID(
      req(`/api/notes/${note.id}`, { method: "PATCH", cookie: other.cookie, body: JSON.stringify({ title: "Hacked" }) }),
      params({ id: note.id }),
    );
    expect(foreignPatch.status).toBe(403);

    const del = await DEL_ID(req(`/api/notes/${note.id}`, { method: "DELETE", cookie: u.cookie }), params({ id: note.id }));
    expect(del.status).toBe(204);
  });

  it("note links CRUD", async () => {
    const nc = await POST(req("/api/notes", { method: "POST", cookie: u.cookie, body: JSON.stringify(noteBody({ title: "Linker" })) }));
    const note = await nc.json();

    const list0 = await GET_LINKS(req(`/api/notes/${note.id}/links`, { cookie: u.cookie }), params({ id: note.id }));
    expect((await list0.json()).length).toBe(0);

    const create = await POST_LINK(
      req(`/api/notes/${note.id}/links`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ targetKind: "note", targetId: null, targetTitleRaw: "Some Title" }),
      }),
      params({ id: note.id }),
    );
    expect(create.status).toBe(201);
    const link = await create.json();

    const list1 = await GET_LINKS(req(`/api/notes/${note.id}/links`, { cookie: u.cookie }), params({ id: note.id }));
    expect((await list1.json()).length).toBe(1);

    const forbidden = await POST_LINK(
      req(`/api/notes/${note.id}/links`, {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ targetKind: "note", targetTitleRaw: "X" }),
      }),
      params({ id: note.id }),
    );
    expect(forbidden.status).toBe(403);

    const del = await DEL_LINK(
      req(`/api/notes/${note.id}/links/${link.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: note.id, linkId: link.id }),
    );
    expect(del.status).toBe(204);
  });
});
