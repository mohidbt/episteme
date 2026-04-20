import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import {
  DELETE as DEL_ID,
  GET as GET_ID,
  PATCH as PATCH_ID,
} from "./[id]/route";
import {
  createTestUser,
  deleteTestUser,
  params,
  req,
} from "../_test-utils";

let userId: string;
let otherId: string;

beforeAll(async () => {
  userId = await createTestUser();
  otherId = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(userId);
  await deleteTestUser(otherId);
});

describe("libraries", () => {
  it("401 without user header", async () => {
    const r = await GET(req("/api/libraries"));
    expect(r.status).toBe(401);
  });

  it("400 on missing name", async () => {
    const r = await POST(req("/api/libraries", { method: "POST", userId, body: "{}" }));
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error).toBe("validation");
  });

  it("golden path: create, list, get, patch, delete", async () => {
    const c = await POST(
      req("/api/libraries", { method: "POST", userId, body: JSON.stringify({ name: "My Lib" }) }),
    );
    expect(c.status).toBe(201);
    const lib = await c.json();
    expect(lib.name).toBe("My Lib");

    const list = await GET(req("/api/libraries", { userId }));
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === lib.id)).toBe(true);

    const one = await GET_ID(req(`/api/libraries/${lib.id}`, { userId }), params({ id: String(lib.id) }));
    expect(one.status).toBe(200);

    const patched = await PATCH_ID(
      req(`/api/libraries/${lib.id}`, { method: "PATCH", userId, body: JSON.stringify({ name: "Renamed" }) }),
      params({ id: String(lib.id) }),
    );
    expect((await patched.json()).name).toBe("Renamed");

    const del = await DEL_ID(
      req(`/api/libraries/${lib.id}`, { method: "DELETE", userId }),
      params({ id: String(lib.id) }),
    );
    expect(del.status).toBe(204);

    const missing = await GET_ID(req(`/api/libraries/${lib.id}`, { userId }), params({ id: String(lib.id) }));
    expect(missing.status).toBe(404);
  });

  it("forbids other user mutation", async () => {
    const c = await POST(
      req("/api/libraries", { method: "POST", userId, body: JSON.stringify({ name: "Secret" }) }),
    );
    const lib = await c.json();
    const r = await PATCH_ID(
      req(`/api/libraries/${lib.id}`, { method: "PATCH", userId: otherId, body: JSON.stringify({ name: "Hack" }) }),
      params({ id: String(lib.id) }),
    );
    expect(r.status).toBe(403);
  });
});
