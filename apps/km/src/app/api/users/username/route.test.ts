import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@episteme/db/schema";
import { POST } from "./route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../_test-utils";

let u: TestUser;
let other: TestUser;

const rand = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("POST /api/users/username", () => {
  it("401 when unauthenticated", async () => {
    const r = await POST(
      req("/api/users/username", {
        method: "POST",
        body: JSON.stringify({ username: `mohid-${rand()}` }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 when username is invalid (too short / uppercase / underscore)", async () => {
    const bad = ["ab", "Mohid", "foo_bar"];
    for (const username of bad) {
      const r = await POST(
        req("/api/users/username", {
          method: "POST",
          cookie: u.cookie,
          body: JSON.stringify({ username }),
        }),
      );
      expect(r.status).toBe(400);
    }
  });

  it("400 when username is reserved", async () => {
    for (const username of ["app", "api"]) {
      const r = await POST(
        req("/api/users/username", {
          method: "POST",
          cookie: u.cookie,
          body: JSON.stringify({ username }),
        }),
      );
      expect(r.status).toBe(400);
    }
  });

  it("200 + sets user.username on successful claim", async () => {
    const name = `mohid-test-${rand()}`;
    const r = await POST(
      req("/api/users/username", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ username: name }),
      }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.username).toBe(name);

    const rows = await db.select().from(user).where(eq(user.id, u.id));
    expect(rows[0].username).toBe(name);
  });

  it("409 when username already taken by another user", async () => {
    const name = `taken-${rand()}`;
    const a = await POST(
      req("/api/users/username", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ username: name }),
      }),
    );
    expect(a.status).toBe(200);

    const b = await POST(
      req("/api/users/username", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ username: name }),
      }),
    );
    expect(b.status).toBe(409);
    expect((await b.json()).error).toBe("taken");
  });

  it("200 when same user re-claims their own username (idempotent)", async () => {
    const name = `idem-${rand()}`;
    const a = await POST(
      req("/api/users/username", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ username: name }),
      }),
    );
    expect(a.status).toBe(200);

    const b = await POST(
      req("/api/users/username", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ username: name }),
      }),
    );
    expect(b.status).toBe(200);
    expect((await b.json()).username).toBe(name);
  });
});
