import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, papers } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_RENAME } from "./rename/route";
import { POST as POST_DELETE } from "./delete/route";
import { POST as POST_LIB } from "../libraries/route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  const r = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ name: "Folders Lib" }),
    }),
  );
  libraryId = (await r.json()).id;
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("rename deprecation", () => {
  it("returns 410 Gone with pointer to new route", async () => {
    const r = await POST_RENAME(
      req("/api/folders/rename", {
        method: "POST",
        body: JSON.stringify({ libraryId, section: "notes", oldPath: "a/", newPath: "b/" }),
      }),
    );
    expect(r.status).toBe(410);
    const body = await r.json();
    expect(body.error).toBe("deprecated — use PATCH /api/folders/:id");
  });
});

describe("delete deprecation", () => {
  it("returns 410 Gone with pointer to new route", async () => {
    const r = await POST_DELETE(
      req("/api/folders/delete", {
        method: "POST",
        body: JSON.stringify({ libraryId, section: "notes", path: "a/" }),
      }),
    );
    expect(r.status).toBe(410);
    const body = await r.json();
    expect(body.error).toBe("deprecated — use POST /api/folders/trash");
  });
});

describe("POST /api/folders", () => {
  it("creates a folder under the library root", async () => {
    const res = await POST(req("/api/folders", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, parentId: null, name: "Research" }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects duplicate sibling name", async () => {
    const res = await POST(req("/api/folders", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, parentId: null, name: "Research" }),
    }));
    expect(res.status).toBe(409);
  });

  it("rejects reserved name 'Trash'", async () => {
    const res = await POST(req("/api/folders", {
      method: "POST",
      cookie: u.cookie,
      body: JSON.stringify({ libraryId, parentId: null, name: "Trash" }),
    }));
    expect(res.status).toBe(400);
  });

  it("rejects when the user does not own the library", async () => {
    const res = await POST(req("/api/folders", {
      method: "POST",
      cookie: other.cookie,
      body: JSON.stringify({ libraryId, parentId: null, name: "X" }),
    }));
    expect(res.status).toBe(404);
  });
});
