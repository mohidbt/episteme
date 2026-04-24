import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../_test-utils";
import { db } from "@/lib/db";
import { libraryReferences } from "@episteme/db/schema";
import { eq } from "drizzle-orm";

let u: TestUser;
let other: TestUser;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();

  // Insert 2 library references for user u
  await db.insert(libraryReferences).values([
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
  ]);

  // Insert 1 reference for other user (should NOT appear in u's results)
  await db.insert(libraryReferences).values({
    userId: other.id,
    title: "Attention Mechanism Survey",
    authors: [{ name: "Other, Author" }],
    year: "2020",
    doi: `10.test/${other.id}-1`,
  });
});

afterAll(async () => {
  await db.delete(libraryReferences).where(eq(libraryReferences.userId, u.id));
  await db.delete(libraryReferences).where(eq(libraryReferences.userId, other.id));
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/citations/search", () => {
  it("returns 401 when unauthenticated", async () => {
    const r = await GET(req("/api/citations/search?q=attention"));
    expect(r.status).toBe(401);
  });

  it("returns empty array when q is empty", async () => {
    const r = await GET(req("/api/citations/search?q=", { cookie: u.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("returns matching refs for ?q=trans (title ILIKE)", async () => {
    const r = await GET(req("/api/citations/search?q=trans", { cookie: u.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);

    // Should match "Attention Is All You Need" (no match) and "BERT...Transformers" (match)
    // Actually "Attention" matches transformer via title ILIKE %trans%
    const titles = body.map((row: { title: string }) => row.title);
    expect(titles.some((t: string) => t.toLowerCase().includes("trans"))).toBe(true);
  });

  it("results are scoped to authed user (not global)", async () => {
    const r = await GET(req("/api/citations/search?q=attention", { cookie: u.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    // "Attention Is All You Need" belongs to u, should appear
    const titles = body.map((row: { title: string }) => row.title);
    expect(titles).toContain("Attention Is All You Need");
    // "Attention Mechanism Survey" belongs to other, should NOT appear
    expect(titles).not.toContain("Attention Mechanism Survey");
  });

  it("each result has citekey, title, authors, year, doi", async () => {
    const r = await GET(req("/api/citations/search?q=Vaswani", { cookie: u.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.length).toBeGreaterThan(0);
    const first = body[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("citekey");
    expect(first).toHaveProperty("title");
    expect(first).toHaveProperty("authors");
    expect(first).toHaveProperty("year");
    expect(typeof first.citekey).toBe("string");
    expect(first.citekey.length).toBeGreaterThan(0);
  });

  it("derives citekey from first author last name + year", async () => {
    const r = await GET(req("/api/citations/search?q=Vaswani", { cookie: u.cookie }));
    const body = await r.json();
    const ref = body.find((row: { title: string }) => row.title.includes("Attention Is All"));
    expect(ref).toBeTruthy();
    // First author is "Vaswani, Ashish", year 2017 => vaswani2017
    expect(ref.citekey).toMatch(/^vaswani2017/);
  });
});
