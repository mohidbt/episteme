import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { POST as POST_LIB } from "../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../_test-utils";

let u: TestUser;
let other: TestUser;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
  await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "u Lib" }) }),
  );
  await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "other Lib" }) }),
  );
}, 60_000);

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("/api/papersets POST", () => {
  it("rejects unauthenticated", async () => {
    const r = await POST(req("/api/papersets", { method: "POST", body: "{}" }));
    expect(r.status).toBe(401);
  });

  it("creates paperset with columns", async () => {
    const r = await POST(
      req("/api/papersets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          filename: "bench.csv",
          folderId: null,
          columns: [{ name: "assay_type", description: "What assay?" }],
        }),
      }),
    );
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.filename).toBe("bench.csv");
    expect(body.columns).toHaveLength(1);
    expect(body.rowRefs).toEqual([]);
    expect(body.userId).toBe(u.id);
  });

  it("rejects empty columns array", async () => {
    const r = await POST(
      req("/api/papersets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ filename: "x.csv", columns: [] }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("auto-suffixes .csv", async () => {
    const r = await POST(
      req("/api/papersets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          filename: "bench",
          columns: [{ name: "x", description: "y" }],
        }),
      }),
    );
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.filename).toBe("bench.csv");
  });

  it("rejects filename containing slash (path traversal)", async () => {
    const r = await POST(
      req("/api/papersets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          filename: "foo/bar.csv",
          columns: [{ name: "x", description: "y" }],
        }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("rejects whitespace-only filename", async () => {
    const r = await POST(
      req("/api/papersets", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({
          filename: "   ",
          columns: [{ name: "x", description: "y" }],
        }),
      }),
    );
    expect(r.status).toBe(400);
  });
});

describe("/api/papersets GET", () => {
  it("rejects unauthenticated", async () => {
    const r = await GET(req("/api/papersets"));
    expect(r.status).toBe(401);
  });

  it("returns user's papersets only", async () => {
    // Seed for `other` — should NOT show in u's list.
    await POST(
      req("/api/papersets", {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({
          filename: "other.csv",
          columns: [{ name: "x", description: "y" }],
        }),
      }),
    );
    const r = await GET(req("/api/papersets", { cookie: u.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.every((p: { userId: string }) => p.userId === u.id)).toBe(true);
    // u created at least one paperset in the POST suite
    expect(body.length).toBeGreaterThan(0);
  });
});
