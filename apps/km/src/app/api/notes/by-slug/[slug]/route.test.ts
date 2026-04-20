import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { POST as POST_LIB } from "../../../libraries/route";
import { POST as POST_NOTE } from "../../route";
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
let slug: string;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "By-Slug Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
  const n = await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: "By Slug Note" }),
    }),
  );
  slug = (await n.json()).slug;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/notes/by-slug/:slug", () => {
  it("401 no cookie", async () => {
    const r = await GET(req(`/api/notes/by-slug/${slug}`), params({ slug }));
    expect(r.status).toBe(401);
  });

  it("404 when not owned (cross-user)", async () => {
    const r = await GET(
      req(`/api/notes/by-slug/${slug}`, { cookie: other.cookie }),
      params({ slug }),
    );
    expect(r.status).toBe(404);
  });

  it("200 returns note row for owner", async () => {
    const r = await GET(
      req(`/api/notes/by-slug/${slug}`, { cookie: u.cookie }),
      params({ slug }),
    );
    expect(r.status).toBe(200);
    const row = await r.json();
    expect(row.slug).toBe(slug);
    expect(row.title).toBe("By Slug Note");
  });
});
