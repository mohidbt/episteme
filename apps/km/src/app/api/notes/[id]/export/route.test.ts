import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as EXPORT } from "./route";
import { POST } from "../../route";
import { POST as POST_LIB } from "../../../libraries/route";
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
let noteSlug: string;
const contentMd = "# Hello\n\nWorld";

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  const libRes = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Export Lib" }),
    }),
  );
  libraryId = (await libRes.json()).id;

  const noteRes = await POST(
    req("/api/notes", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, title: "Export Note", contentMd }),
    }),
  );
  const note = await noteRes.json();
  noteId = note.id;
  noteSlug = note.slug;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/notes/:id/export", () => {
  it("401 without cookie", async () => {
    const r = await EXPORT(req(`/api/notes/${noteId}/export`), params({ id: noteId }));
    expect(r.status).toBe(401);
  });

  it("403 for a different user", async () => {
    const r = await EXPORT(
      req(`/api/notes/${noteId}/export`, { cookie: other.cookie }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(403);
  });

  it("404 for a random UUID", async () => {
    const randomId = crypto.randomUUID();
    const r = await EXPORT(
      req(`/api/notes/${randomId}/export`, { cookie: u.cookie }),
      params({ id: randomId }),
    );
    expect(r.status).toBe(404);
  });

  it("200 for owner — correct headers and body", async () => {
    const r = await EXPORT(
      req(`/api/notes/${noteId}/export`, { cookie: u.cookie }),
      params({ id: noteId }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("content-disposition")).toBe(
      `attachment; filename="${noteSlug}.md"`,
    );
    expect(await r.text()).toBe(contentMd);
  });
});
