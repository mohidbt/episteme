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
      for (const [k, v] of data) {
        const [u, slug] = k.split("::");
        if (u !== userId) continue;
        let parsed: { name?: string; description?: string; instructions?: string };
        try {
          parsed = JSON.parse(v);
        } catch {
          parsed = {};
        }
        out.push({
          slug,
          name: parsed.name || slug,
          description: parsed.description ?? "",
          instructions: parsed.instructions ?? "",
        });
      }
      return out;
    },
    async read(userId, slug) {
      readCalls.push({ userId, slug });
      const v = data.get(`${userId}::${slug}`);
      if (v === undefined) throw new Error("NoSuchKey");
      return v;
    },
    async write(userId, slug, content) {
      data.set(`${userId}::${slug}`, content);
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
  it("returns 200 + {slug, name, description, instructions} for own skill", async () => {
    const fake = makeFakeStore();
    await fake.write(
      "u1",
      "alpha",
      JSON.stringify({ name: "Alpha", description: "A skill", instructions: "Do X" }),
    );
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
      name: "Alpha",
      description: "A skill",
      instructions: "Do X",
    });
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
    await fake.write("u1", "alpha", "{}");
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
    await fake.write("u2", "secret", JSON.stringify({ name: "Secret", description: "", instructions: "" }));
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

describe("PATCH /api/agents/skills/personal/[slug]", () => {
  it("patches description and instructions independently", async () => {
    const fake = makeFakeStore();
    await fake.write(
      "u1",
      "alpha",
      JSON.stringify({ name: "Alpha", description: "old desc", instructions: "old instr" }),
    );
    __resetSkillStoreForTests(fake);
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/agents/skills/personal/alpha", {
        method: "PATCH",
        body: JSON.stringify({ description: "new desc", instructions: "new instr" }),
      }),
      { params: Promise.resolve({ slug: "alpha" }) },
    );
    expect(res.status).toBe(200);
    const stored = JSON.parse(await fake.read("u1", "alpha"));
    expect(stored).toEqual({
      name: "Alpha",
      description: "new desc",
      instructions: "new instr",
    });
  });

  it("patches only description, leaving instructions unchanged", async () => {
    const fake = makeFakeStore();
    await fake.write(
      "u1",
      "alpha",
      JSON.stringify({ name: "Alpha", description: "", instructions: "keep me" }),
    );
    __resetSkillStoreForTests(fake);
    const { PATCH } = await import("./route");
    await PATCH(
      new Request("http://localhost/api/agents/skills/personal/alpha", {
        method: "PATCH",
        body: JSON.stringify({ description: "new desc" }),
      }),
      { params: Promise.resolve({ slug: "alpha" }) },
    );
    const stored = JSON.parse(await fake.read("u1", "alpha"));
    expect(stored.instructions).toBe("keep me");
    expect(stored.description).toBe("new desc");
  });

  it("returns 404 for nonexistent skill", async () => {
    const fake = makeFakeStore();
    __resetSkillStoreForTests(fake);
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/agents/skills/personal/ghost", {
        method: "PATCH",
        body: JSON.stringify({ description: "x" }),
      }),
      { params: Promise.resolve({ slug: "ghost" }) },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH 401 unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    __resetSkillStoreForTests(makeFakeStore());
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/agents/skills/personal/x", {
        method: "PATCH",
        body: JSON.stringify({ description: "x" }),
      }),
      { params: Promise.resolve({ slug: "x" }) },
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/agents/skills/personal/[slug]", () => {
  it("deletes the skill", async () => {
    const fake = makeFakeStore();
    await fake.write("u1", "tmp", JSON.stringify({ name: "T", description: "", instructions: "" }));
    __resetSkillStoreForTests(fake);
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://localhost/api/agents/skills/personal/tmp", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "tmp" }) },
    );
    expect(res.status).toBe(200);
    expect(fake.dump().has("u1::tmp")).toBe(false);
  });
});