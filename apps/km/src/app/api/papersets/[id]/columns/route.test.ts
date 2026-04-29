import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papersets, libraries } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_PAPERSET } from "../../route";
import { POST as POST_LIB } from "../../../libraries/route";
import { createTestUser, deleteTestUser, params, req, type TestUser } from "../../../_test-utils";

let u: TestUser;
let other: TestUser;
let libraryId: number;
let otherLibraryId: number;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: u.cookie, body: JSON.stringify({ name: "Cols Lib" }) }),
  );
  libraryId = (await r.json()).id;

  const r2 = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: other.cookie, body: JSON.stringify({ name: "Cols Other Lib" }) }),
  );
  otherLibraryId = (await r2.json()).id;
}, 60_000);

afterAll(async () => {
  await db.delete(libraries).where(eq(libraries.id, libraryId));
  await db.delete(libraries).where(eq(libraries.id, otherLibraryId));
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function seedPaperset(opts: {
  cookie?: string;
  columns?: Array<{ name: string; description: string }>;
} = {}): Promise<string> {
  const cookie = opts.cookie ?? u.cookie;
  const columns = opts.columns ?? [{ name: "x", description: "first" }];
  const r = await POST_PAPERSET(
    req("/api/papersets", {
      method: "POST",
      cookie,
      body: JSON.stringify({ filename: "cols.csv", folderId: null, columns }),
    }),
  );
  if (r.status !== 201) throw new Error(`seed paperset failed: ${r.status}`);
  return (await r.json()).id as string;
}

describe("POST /api/papersets/:id/columns", () => {
  it("appends a column", async () => {
    const id = await seedPaperset();
    const r = await POST(
      req(`/api/papersets/${id}/columns`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ name: "n_samples", description: "Number of samples." }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.columns).toHaveLength(2);
    expect(body.columns[1].name).toBe("n_samples");
    expect(body.columns[1].description).toBe("Number of samples.");
  });

  it("409 on duplicate column name", async () => {
    const id = await seedPaperset();
    const r = await POST(
      req(`/api/papersets/${id}/columns`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ name: "x", description: "dup" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("duplicate_column");
  });

  it("400 on empty name", async () => {
    const id = await seedPaperset();
    const r = await POST(
      req(`/api/papersets/${id}/columns`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ name: "", description: "d" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(400);
  });

  it("400 on empty description", async () => {
    const id = await seedPaperset();
    const r = await POST(
      req(`/api/papersets/${id}/columns`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ name: "n", description: "" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(400);
  });

  it("401 unauthenticated", async () => {
    const id = await seedPaperset();
    const r = await POST(
      req(`/api/papersets/${id}/columns`, {
        method: "POST",
        body: JSON.stringify({ name: "n", description: "d" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(401);
  });

  it("404 missing paperset", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    const r = await POST(
      req(`/api/papersets/${fake}/columns`, {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ name: "n", description: "d" }),
      }),
      params({ id: fake }),
    );
    expect(r.status).toBe(404);
  });

  it("403 cross-user", async () => {
    const id = await seedPaperset();
    const r = await POST(
      req(`/api/papersets/${id}/columns`, {
        method: "POST",
        cookie: other.cookie,
        body: JSON.stringify({ name: "n", description: "d" }),
      }),
      params({ id }),
    );
    expect(r.status).toBe(403);
  });
});
