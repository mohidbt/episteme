import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "./route";
import { POST as POST_LIB } from "../../libraries/route";
import { POST as POST_NOTE } from "../route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../_test-utils";

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
      body: JSON.stringify({ name: "Search Lib" }),
    }),
  );
  libraryId = (await r.json()).id;

  const otherLib = await POST_LIB(
    req("/api/libraries", {
      method: "POST",
      cookie: other.cookie,
      body: JSON.stringify({ name: "Other Lib" }),
    }),
  );
  const otherLibId = (await otherLib.json()).id;

  // Seed notes for u
  for (const title of [
    "Transformers",
    "Transformer Circuits",
    "Attention Mechanism",
    "CRISPR",
    "Deep Learning",
  ]) {
    await POST_NOTE(
      req("/api/notes", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ libraryId, title }),
      }),
    );
  }

  // Note owned by a different user — should NOT appear in u's search
  await POST_NOTE(
    req("/api/notes", {
      method: "POST",
      cookie: other.cookie,
      body: JSON.stringify({ libraryId: otherLibId, title: "Transformers" }),
    }),
  );
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

describe("GET /api/notes/search", () => {
  it("401 when no user", async () => {
    const r = await GET(req("/api/notes/search?q=trans"));
    expect(r.status).toBe(401);
  });

  it("returns empty array for missing q", async () => {
    const r = await GET(req("/api/notes/search", { cookie: u.cookie }));
    expect(r.status).toBe(200);
    expect((await r.json()).results).toEqual([]);
  });

  it("returns empty array for whitespace-only q", async () => {
    const r = await GET(
      req("/api/notes/search?q=%20%20", { cookie: u.cookie }),
    );
    expect((await r.json()).results).toEqual([]);
  });

  it("returns empty array when no match", async () => {
    const r = await GET(
      req("/api/notes/search?q=xyzzynomatch", { cookie: u.cookie }),
    );
    expect((await r.json()).results).toEqual([]);
  });

  it("matches by case-insensitive substring", async () => {
    const r = await GET(
      req("/api/notes/search?q=TRANS", { cookie: u.cookie }),
    );
    const { results } = await r.json();
    const titles = results.map((x: { title: string }) => x.title);
    expect(titles).toContain("Transformers");
    expect(titles).toContain("Transformer Circuits");
    expect(titles).not.toContain("CRISPR");
  });

  it("scopes results to the caller's notes", async () => {
    // u has 1 Transformers; other also has a Transformers. Caller is u.
    const r = await GET(
      req("/api/notes/search?q=Transformers", { cookie: u.cookie }),
    );
    const { results } = await r.json();
    const titles = results.map((x: { title: string }) => x.title);
    // Only u's single Transformers row
    const count = titles.filter((t: string) => t === "Transformers").length;
    expect(count).toBe(1);
  });

  it("caps results at 10", async () => {
    // seed 12 more titles starting with 'Cap'
    for (let i = 0; i < 12; i++) {
      await POST_NOTE(
        req("/api/notes", {
          method: "POST",
          cookie: u.cookie,
          body: JSON.stringify({ libraryId, title: `Cap Note ${i}` }),
        }),
      );
    }
    const r = await GET(
      req("/api/notes/search?q=Cap%20Note", { cookie: u.cookie }),
    );
    const { results } = await r.json();
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("results include id, title, slug", async () => {
    const r = await GET(
      req("/api/notes/search?q=CRISPR", { cookie: u.cookie }),
    );
    const { results } = await r.json();
    expect(results.length).toBeGreaterThan(0);
    const [first] = results;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("title");
    expect(first).toHaveProperty("slug");
  });
});
