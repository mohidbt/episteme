import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import {
  DELETE as DEL_ID,
  GET as GET_ID,
  PATCH as PATCH_ID,
} from "./[id]/route";
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
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Papers Lib" }) }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

const paperBody = (overrides: Record<string, unknown> = {}) => ({
  libraryId,
  filename: "a.pdf",
  storageUrl: "s3://x/a.pdf",
  title: "Alpha",
  ...overrides,
});

describe("papers", () => {
  it("401 no user", async () => {
    const r = await GET(req("/api/papers?libraryId=" + libraryId));
    expect(r.status).toBe(401);
  });

  it("400 missing libraryId", async () => {
    const r = await GET(req("/api/papers", { cookie: u.cookie }));
    expect(r.status).toBe(400);
  });

  it("400 validation on POST", async () => {
    const r = await POST(req("/api/papers", { method: "POST", cookie: u.cookie, body: JSON.stringify({ libraryId }) }));
    expect(r.status).toBe(400);
  });

  it("403 creating paper in other user's library", async () => {
    const r = await POST(
      req("/api/papers", { method: "POST", cookie: other.cookie, body: JSON.stringify(paperBody()) }),
    );
    expect(r.status).toBe(403);
  });

  it("golden path CRUD", async () => {
    const c = await POST(req("/api/papers", { method: "POST", cookie: u.cookie, body: JSON.stringify(paperBody()) }));
    expect(c.status).toBe(201);
    const paper = await c.json();

    const list = await GET(req(`/api/papers?libraryId=${libraryId}`, { cookie: u.cookie }));
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === paper.id)).toBe(true);

    const one = await GET_ID(req(`/api/papers/${paper.id}`, { cookie: u.cookie }), params({ id: paper.id }));
    expect(one.status).toBe(200);

    const patched = await PATCH_ID(
      req(`/api/papers/${paper.id}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ title: "Beta" }) }),
      params({ id: paper.id }),
    );
    expect((await patched.json()).title).toBe("Beta");

    const del = await DEL_ID(req(`/api/papers/${paper.id}`, { method: "DELETE", cookie: u.cookie }), params({ id: paper.id }));
    expect(del.status).toBe(204);
  });

  it("ownership: cannot patch other's paper", async () => {
    const c = await POST(req("/api/papers", { method: "POST", cookie: u.cookie, body: JSON.stringify(paperBody()) }));
    const paper = await c.json();
    const r = await PATCH_ID(
      req(`/api/papers/${paper.id}`, { method: "PATCH", cookie: other.cookie, body: JSON.stringify({ title: "hack" }) }),
      params({ id: paper.id }),
    );
    expect(r.status).toBe(403);
  });

  it("folderPath filter", async () => {
    await POST(
      req("/api/papers", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify(paperBody({ filename: "in-folder.pdf", folderPath: "foo" })),
      }),
    );
    const r = await GET(req(`/api/papers?libraryId=${libraryId}&folderPath=foo`, { cookie: u.cookie }));
    const rows = await r.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p: any) => p.folderPath === "foo")).toBe(true);
  });
});
