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
} from "../_test-utils";

let userId: string;
let otherId: string;
let libraryId: number;

beforeAll(async () => {
  userId = await createTestUser();
  otherId = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", userId, body: JSON.stringify({ name: "Refs Lib" }) }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(userId);
  await deleteTestUser(otherId);
});

let keyCounter = 0;
const uniqueKey = () => `key${Date.now()}${keyCounter++}`;
const refBody = (overrides: Record<string, unknown> = {}) => ({
  libraryId,
  citationKey: uniqueKey(),
  cslJson: { type: "article-journal", title: "Paper" },
  ...overrides,
});

describe("references", () => {
  it("401 no user", async () => {
    const r = await GET(req(`/api/references?libraryId=${libraryId}`));
    expect(r.status).toBe(401);
  });

  it("400 invalid citation key", async () => {
    const r = await POST(
      req("/api/references", {
        method: "POST",
        userId,
        body: JSON.stringify(refBody({ citationKey: "has space" })),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("403 creating ref in other user's library", async () => {
    const r = await POST(
      req("/api/references", { method: "POST", userId: otherId, body: JSON.stringify(refBody()) }),
    );
    expect(r.status).toBe(403);
  });

  it("golden path CRUD", async () => {
    const c = await POST(req("/api/references", { method: "POST", userId, body: JSON.stringify(refBody()) }));
    expect(c.status).toBe(201);
    const ref = await c.json();

    const list = await GET(req(`/api/references?libraryId=${libraryId}`, { userId }));
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === ref.id)).toBe(true);

    const one = await GET_ID(req(`/api/references/${ref.id}`, { userId }), params({ id: ref.id }));
    expect(one.status).toBe(200);

    const newKey = uniqueKey();
    const patched = await PATCH_ID(
      req(`/api/references/${ref.id}`, { method: "PATCH", userId, body: JSON.stringify({ citationKey: newKey }) }),
      params({ id: ref.id }),
    );
    expect((await patched.json()).citationKey).toBe(newKey);

    const del = await DEL_ID(req(`/api/references/${ref.id}`, { method: "DELETE", userId }), params({ id: ref.id }));
    expect(del.status).toBe(204);
  });

  it("ownership: other user cannot delete", async () => {
    const c = await POST(req("/api/references", { method: "POST", userId, body: JSON.stringify(refBody()) }));
    const ref = await c.json();
    const r = await DEL_ID(
      req(`/api/references/${ref.id}`, { method: "DELETE", userId: otherId }),
      params({ id: ref.id }),
    );
    expect(r.status).toBe(403);
  });
});
