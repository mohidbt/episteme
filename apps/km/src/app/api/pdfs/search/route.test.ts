import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { internalAuthTestHeaders } from "@/__tests__/internal-auth-headers";
import { GET } from "./route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../_test-utils";
import { db } from "@/lib/db";
import { papers, libraries } from "@episteme/db/schema";
import { eq } from "drizzle-orm";

const HMAC_SECRET = "test-pdfs-search-secret";

let uA: TestUser;
let uB: TestUser;
let libAId: number;
let libBId: number;

beforeAll(async () => {
  uA = await createTestUser();
  uB = await createTestUser();

  // Create a library for each user (papers FK requires libraryId)
  const [libA] = await db
    .insert(libraries)
    .values({ userId: uA.id, name: "Lib A" })
    .returning({ id: libraries.id });
  libAId = libA.id;

  const [libB] = await db
    .insert(libraries)
    .values({ userId: uB.id, name: "Lib B" })
    .returning({ id: libraries.id });
  libBId = libB.id;

  // Seed User A with 2 papers
  await db.insert(papers).values([
    {
      userId: uA.id,
      libraryId: libAId,
      filename: "transformers_attention.pdf",
      title: "Attention Is All You Need",
      authors: ["Vaswani, Ashish", "Shazeer, Noam"],
      year: 2017,
      doi: "10.test/uA-1",
    },
    {
      userId: uA.id,
      libraryId: libAId,
      filename: "bert_pretraining.pdf",
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      authors: ["Devlin, Jacob"],
      year: 2018,
      doi: "10.test/uA-2",
    },
  ]);

  // Seed User B with 1 paper (should NOT appear in A's results)
  await db.insert(papers).values({
    userId: uB.id,
    libraryId: libBId,
    filename: "survey_attention.pdf",
    title: "Attention Mechanism Survey",
    authors: ["Other, Author"],
    year: 2020,
    doi: "10.test/uB-1",
  });
});

afterAll(async () => {
  await db.delete(papers).where(eq(papers.userId, uA.id));
  await db.delete(papers).where(eq(papers.userId, uB.id));
  await db.delete(libraries).where(eq(libraries.id, libAId));
  await db.delete(libraries).where(eq(libraries.id, libBId));
  await deleteTestUser(uA.id);
  await deleteTestUser(uB.id);
});

describe("GET /api/pdfs/search", () => {
  it("returns 401 when unauthenticated", async () => {
    const r = await GET(req("/api/pdfs/search?q=attention"));
    expect(r.status).toBe(401);
  });

  it("returns empty results when q is empty", async () => {
    const r = await GET(req("/api/pdfs/search?q=", { cookie: uA.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("results");
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBe(0);
  });

  it("result shape includes id, title, filename, year, doi", async () => {
    const r = await GET(req("/api/pdfs/search?q=attention", { cookie: uA.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results.length).toBeGreaterThan(0);
    const first = body.results[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("title");
    expect(first).toHaveProperty("filename");
    expect(first).toHaveProperty("year");
    expect(first).toHaveProperty("doi");
    // page is NOT a stored field — verify it is NOT in response
    expect(first).not.toHaveProperty("page");
  });

  it("user A cannot see user B's papers", async () => {
    const r = await GET(req("/api/pdfs/search?q=attention", { cookie: uA.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    const titles = body.results.map((row: { title: string }) => row.title);
    // User A's paper should appear
    expect(titles).toContain("Attention Is All You Need");
    // User B's paper must NOT appear
    expect(titles).not.toContain("Attention Mechanism Survey");
  });

  it("title ILIKE search works (q=trans)", async () => {
    const r = await GET(req("/api/pdfs/search?q=trans", { cookie: uA.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    const titles = body.results.map((row: { title: string }) => row.title);
    // "BERT...Transformers" has "trans" in title
    expect(
      titles.some((t: string) => t.toLowerCase().includes("trans")),
    ).toBe(true);
  });

  it("filename ILIKE search works (q=bert_pre)", async () => {
    const r = await GET(req("/api/pdfs/search?q=bert_pre", { cookie: uA.cookie }));
    expect(r.status).toBe(200);
    const body = await r.json();
    const filenames = body.results.map((row: { filename: string }) => row.filename);
    expect(filenames.some((f: string) => f.includes("bert"))).toBe(true);
  });

  it("accepts HMAC-signed request from agent", async () => {
    const prevSecret = process.env.INHALE_INTERNAL_SECRET;
    process.env.INHALE_INTERNAL_SECRET = HMAC_SECRET;
    try {
      const path = "/api/pdfs/search?q=attention";
      const r = await GET(
        new Request(`http://localhost${path}`, {
          headers: internalAuthTestHeaders({
            secret: HMAC_SECRET,
            userId: uA.id,
            method: "GET",
            path,
          }),
        }),
      );
      expect(r.status).toBe(200);
      const body = await r.json();
      const titles = body.results.map((row: { title: string }) => row.title);
      expect(titles).toContain("Attention Is All You Need");
      // Cross-user isolation still enforced: u_B's paper must NOT appear
      expect(titles).not.toContain("Attention Mechanism Survey");
    } finally {
      if (prevSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
      else process.env.INHALE_INTERNAL_SECRET = prevSecret;
    }
  });
});
