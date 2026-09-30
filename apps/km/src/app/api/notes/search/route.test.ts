import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes } from "@episteme/db/schema";
import { getTrashFolderId } from "@/lib/folders-server";
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

describe("GET /api/notes/search?sort=recent", () => {
  async function recent(query = "") {
    const r = await GET(
      req(`/api/notes/search?sort=recent&k=50${query}`, { cookie: u.cookie }),
    );
    return (await r.json()).results as { id: string; title: string; updatedAt: string }[];
  }

  async function idOf(title: string): Promise<string> {
    const [row] = await db.select({ id: notes.id }).from(notes).where(eq(notes.title, title));
    return row.id;
  }

  it("lists notes for an empty q, last edited first, with updatedAt", async () => {
    await db
      .update(notes)
      .set({ updatedAt: new Date("2030-01-02T00:00:00Z") })
      .where(eq(notes.id, await idOf("CRISPR")));
    await db
      .update(notes)
      .set({ updatedAt: new Date("2030-01-01T00:00:00Z") })
      .where(eq(notes.id, await idOf("Deep Learning")));
    const results = await recent();
    expect(results.slice(0, 2).map((x) => x.title)).toEqual(["CRISPR", "Deep Learning"]);
    expect(results[0].updatedAt).toBe("2030-01-02T00:00:00.000Z");
  });

  it("filters by q", async () => {
    const titles = (await recent("&q=crisp")).map((x) => x.title);
    expect(titles).toEqual(["CRISPR"]);
  });

  it("excludes notes in the trash folder", async () => {
    const trashId = await getTrashFolderId(libraryId, u.id);
    await db
      .update(notes)
      .set({ folderId: trashId })
      .where(eq(notes.id, await idOf("Attention Mechanism")));
    const titles = (await recent()).map((x) => x.title);
    expect(titles).not.toContain("Attention Mechanism");
    expect(titles).toContain("Transformers");
  });

  it("leaves the default search untouched: title order, no updatedAt", async () => {
    const r = await GET(req("/api/notes/search?q=Trans", { cookie: u.cookie }));
    const { results } = await r.json();
    expect(results.map((x: { title: string }) => x.title)).toEqual([
      "Transformer Circuits",
      "Transformers",
    ]);
    expect(results[0]).not.toHaveProperty("updatedAt");
  });
});
