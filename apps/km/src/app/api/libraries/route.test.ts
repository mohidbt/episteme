import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders } from "@episteme/db/schema";
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
  type TestUser,
} from "../_test-utils";

let u: TestUser;
let other: TestUser;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("libraries", () => {
  it("401 without session", async () => {
    const r = await GET(req("/api/libraries"));
    expect(r.status).toBe(401);
  });

  it("400 on missing name", async () => {
    const r = await POST(req("/api/libraries", { method: "POST", cookie: u.cookie, body: "{}" }));
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error).toBe("validation");
  });

  it("golden path: create, list, get, patch, delete", async () => {
    const c = await POST(
      req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "My Lib" }) }),
    );
    expect(c.status).toBe(201);
    const lib = await c.json();
    expect(lib.name).toBe("My Lib");

    const list = await GET(req("/api/libraries", { cookie: u.cookie }));
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === lib.id)).toBe(true);

    const one = await GET_ID(req(`/api/libraries/${lib.id}`, { cookie: u.cookie }), params({ id: String(lib.id) }));
    expect(one.status).toBe(200);

    const patched = await PATCH_ID(
      req(`/api/libraries/${lib.id}`, { method: "PATCH", cookie: u.cookie, body: JSON.stringify({ name: "Renamed" }) }),
      params({ id: String(lib.id) }),
    );
    expect((await patched.json()).name).toBe("Renamed");

    const del = await DEL_ID(
      req(`/api/libraries/${lib.id}`, { method: "DELETE", cookie: u.cookie }),
      params({ id: String(lib.id) }),
    );
    expect(del.status).toBe(204);

    const missing = await GET_ID(req(`/api/libraries/${lib.id}`, { cookie: u.cookie }), params({ id: String(lib.id) }));
    expect(missing.status).toBe(404);
  });

  it("auto-seeds a Trash folder when creating a library", async () => {
    // Fresh user — POST /api/libraries enforces one-library-per-user (409
    // on second POST), so each test that creates a library needs its own.
    const fresh = await createTestUser();
    try {
      const c = await POST(
        req("/api/libraries", {
          method: "POST",
          cookie: fresh.cookie,
          body: JSON.stringify({ name: "Trash-Seeded Lib" }),
        }),
      );
      expect(c.status).toBe(201);
      const lib = await c.json();

      const trashRows = await db
        .select({
          id: folders.id,
          name: folders.name,
          parentId: folders.parentId,
          isTrash: folders.isTrash,
          userId: folders.userId,
        })
        .from(folders)
        .where(and(eq(folders.libraryId, lib.id), eq(folders.isTrash, true)));
      expect(trashRows.length).toBe(1);
      expect(trashRows[0].name).toBe("Trash");
      expect(trashRows[0].parentId).toBeNull();
      expect(trashRows[0].isTrash).toBe(true);
      expect(trashRows[0].userId).toBe(fresh.id);
    } finally {
      await deleteTestUser(fresh.id);
    }
  });

  it("forbids other user mutation", async () => {
    const owner = await createTestUser();
    try {
      const c = await POST(
        req("/api/libraries", { method: "POST", cookie: owner.cookie, body: JSON.stringify({ name: "Secret" }) }),
      );
      const lib = await c.json();
      const r = await PATCH_ID(
        req(`/api/libraries/${lib.id}`, { method: "PATCH", cookie: other.cookie, body: JSON.stringify({ name: "Hack" }) }),
        params({ id: String(lib.id) }),
      );
      expect(r.status).toBe(403);
    } finally {
      await deleteTestUser(owner.id);
    }
  });

  it("409 when user already has a library", async () => {
    const solo = await createTestUser();
    try {
      const first = await POST(
        req("/api/libraries", { method: "POST", cookie: solo.cookie, body: JSON.stringify({ name: "First" }) }),
      );
      expect(first.status).toBe(201);
      const dup = await POST(
        req("/api/libraries", { method: "POST", cookie: solo.cookie, body: JSON.stringify({ name: "Second" }) }),
      );
      expect(dup.status).toBe(409);
      const j = await dup.json();
      expect(j.error).toBe("library_exists");
    } finally {
      await deleteTestUser(solo.id);
    }
  });
});
