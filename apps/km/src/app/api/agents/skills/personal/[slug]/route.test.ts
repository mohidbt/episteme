// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

import { getSessionInfo } from "@/lib/auth";
import {
  __resetSkillStoreForTests,
  type SkillStore,
  type SkillManifest,
} from "@/lib/skills-store";

function makeFakeStore(): SkillStore & {
  dump: () => Map<string, string>;
  readCalls: Array<{ userId: string; slug: string }>;
} {
  const data = new Map<string, string>();
  const readCalls: Array<{ userId: string; slug: string }> = [];
  return {
    async list(userId) {
      const out: SkillManifest[] = [];
      for (const [k] of data) {
        const [u, slug] = k.split("::");
        if (u !== userId) continue;
        out.push({ slug, name: slug, description: "", category: "writing" });
      }
      return out;
    },
    async read(userId, slug) {
      readCalls.push({ userId, slug });
      const v = data.get(`${userId}::${slug}`);
      if (v === undefined) throw new Error("NoSuchKey");
      return v;
    },
    async write(userId, slug, md) {
      data.set(`${userId}::${slug}`, md);
    },
    async delete(userId, slug) {
      data.delete(`${userId}::${slug}`);
    },
    dump: () => data,
    readCalls,
  };
}

beforeEach(() => {
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
});

afterEach(() => {
  __resetSkillStoreForTests();
  vi.restoreAllMocks();
});

describe("GET /api/agents/skills/personal/[slug]", () => {
  it("returns 200 + {slug, md} for own skill", async () => {
    const fake = makeFakeStore();
    await fake.write("u1", "alpha", "---\nname: Alpha\n---\n# Alpha\n\nBody.");
    __resetSkillStoreForTests(fake);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agents/skills/personal/alpha"),
      { params: Promise.resolve({ slug: "alpha" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      slug: "alpha",
      md: "---\nname: Alpha\n---\n# Alpha\n\nBody.",
    });
    expect(fake.readCalls).toEqual([{ userId: "u1", slug: "alpha" }]);
  });

  it("returns 404 for unknown slug", async () => {
    const fake = makeFakeStore();
    __resetSkillStoreForTests(fake);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agents/skills/personal/missing"),
      { params: Promise.resolve({ slug: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 with no session", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const fake = makeFakeStore();
    await fake.write("u1", "alpha", "x");
    __resetSkillStoreForTests(fake);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agents/skills/personal/alpha"),
      { params: Promise.resolve({ slug: "alpha" }) },
    );
    expect(res.status).toBe(401);
  });

  it("scopes by session userId (does not leak other users' skills)", async () => {
    const fake = makeFakeStore();
    await fake.write("u2", "secret", "other user content");
    __resetSkillStoreForTests(fake);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/agents/skills/personal/secret"),
      { params: Promise.resolve({ slug: "secret" }) },
    );
    expect(res.status).toBe(404);
    expect(fake.readCalls).toEqual([{ userId: "u1", slug: "secret" }]);
  });
});
