import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "./route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../_test-utils";
import { db } from "@/lib/db";
import { libraryReferences } from "@episteme/db/schema";
import { eq } from "drizzle-orm";

let u: TestUser;
let other: TestUser;
let uRefIds: number[] = [];
let otherRefIds: number[] = [];

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  // Insert references for user u with known citekeys:
  //   vaswani2017 = "Vaswani, Ashish" + 2017
  //   devlin2018  = "Devlin, Jacob" + 2018
  const inserted = await db.insert(libraryReferences).values([
    {
      userId: u.id,
      title: "Attention Is All You Need",
      authors: [{ name: "Vaswani, Ashish" }, { name: "Shazeer, Noam" }],
      year: "2017",
      doi: `10.test/${u.id}-1`,
    },
    {
      userId: u.id,
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      authors: [{ name: "Devlin, Jacob" }],
      year: "2018",
      doi: `10.test/${u.id}-2`,
    },
  ]).returning({ id: libraryReferences.id });
  uRefIds = inserted.map((r) => r.id);

  // Insert 1 reference for other user (should NOT appear in u's results)
  const otherInserted = await db.insert(libraryReferences).values({
    userId: other.id,
    title: "Attention Mechanism Survey",
    authors: [{ name: "Vaswani, Ashish" }], // same author, same citekey → vaswani2020
    year: "2020",
    doi: `10.test/${other.id}-1`,
  }).returning({ id: libraryReferences.id });
  otherRefIds = otherInserted.map((r) => r.id);
});

afterAll(async () => {
  for (const id of uRefIds) {
    await db.delete(libraryReferences).where(eq(libraryReferences.id, id));
  }
  for (const id of otherRefIds) {
    await db.delete(libraryReferences).where(eq(libraryReferences.id, id));
  }
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("POST /api/citations/by-citekeys", () => {
  it("returns 401 when unauthenticated", async () => {
    const r = await POST(req("/api/citations/by-citekeys", {
      method: "POST",
      body: JSON.stringify({ citekeys: ["vaswani2017"] }),
    }));
    expect(r.status).toBe(401);
  });

  it("empty citekeys array returns empty results", async () => {
    const r = await POST(req("/api/citations/by-citekeys", {
      method: "POST",
      body: JSON.stringify({ citekeys: [] }),
      cookie: u.cookie,
    }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ results: [] });
  });

  it("returns matching citekeys for authed user", async () => {
    const r = await POST(req("/api/citations/by-citekeys", {
      method: "POST",
      body: JSON.stringify({ citekeys: ["vaswani2017", "devlin2018"] }),
      cookie: u.cookie,
    }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results).toHaveLength(2);

    const citekeys = body.results.map((item: { citekey: string }) => item.citekey);
    expect(citekeys).toContain("vaswani2017");
    expect(citekeys).toContain("devlin2018");
  });

  it("results are scoped per user — user A cannot see user B citekeys", async () => {
    // vaswani2020 belongs to `other`, not `u`
    const r = await POST(req("/api/citations/by-citekeys", {
      method: "POST",
      body: JSON.stringify({ citekeys: ["vaswani2020"] }),
      cookie: u.cookie,
    }));
    expect(r.status).toBe(200);
    const body = await r.json();
    // u has no vaswani2020 → empty
    expect(body.results).toHaveLength(0);
  });

  it("missing citekeys are silently absent (not an error)", async () => {
    const r = await POST(req("/api/citations/by-citekeys", {
      method: "POST",
      body: JSON.stringify({ citekeys: ["vaswani2017", "does-not-exist-9999"] }),
      cookie: u.cookie,
    }));
    expect(r.status).toBe(200);
    const body = await r.json();
    // Only vaswani2017 should appear; the missing key is absent
    expect(body.results).toHaveLength(1);
    expect(body.results[0].citekey).toBe("vaswani2017");
  });

  it("each result has citekey, title, authors (string[]), year, doi", async () => {
    const r = await POST(req("/api/citations/by-citekeys", {
      method: "POST",
      body: JSON.stringify({ citekeys: ["vaswani2017"] }),
      cookie: u.cookie,
    }));
    const body = await r.json();
    const item = body.results[0];
    expect(item).toHaveProperty("citekey", "vaswani2017");
    expect(item).toHaveProperty("title");
    expect(Array.isArray(item.authors)).toBe(true);
    // authors should be string[] (names only, not objects)
    expect(typeof item.authors[0]).toBe("string");
    expect(item).toHaveProperty("year");
    expect(item).toHaveProperty("doi");
  });
});
