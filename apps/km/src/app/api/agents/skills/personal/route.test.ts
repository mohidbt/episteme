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

function makeFakeStore(): SkillStore & { dump: () => Map<string, string> } {
  const data = new Map<string, string>();
  return {
    async list(userId) {
      const out: SkillManifest[] = [];
      for (const [k, v] of data) {
        const [u, slug] = k.split("::");
        if (u !== userId) continue;
        const name = /name:\s*([^\n]+)/.exec(v)?.[1]?.trim() ?? slug;
        out.push({ slug, name, description: "", category: "writing" });
      }
      return out.sort((a, b) => a.slug.localeCompare(b.slug));
    },
    async read(userId, slug) {
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
  };
}

beforeEach(() => {
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
});

afterEach(() => {
  __resetSkillStoreForTests();
  vi.restoreAllMocks();
});

describe("GET/POST /api/agents/skills/personal", () => {
  it("GET 401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    __resetSkillStoreForTests(makeFakeStore());
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agents/skills/personal"));
    expect(res.status).toBe(401);
  });

  it("GET returns empty list for new user", async () => {
    __resetSkillStoreForTests(makeFakeStore());
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agents/skills/personal"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ skills: [] });
  });

  it("POST creates a new skill with auto-slug + frontmatter", async () => {
    const fake = makeFakeStore();
    __resetSkillStoreForTests(fake);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/agents/skills/personal", {
        method: "POST",
        body: JSON.stringify({ name: "My Cool Skill" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("my-cool-skill");
    expect(body.name).toBe("My Cool Skill");
    const md = fake.dump().get("u1::my-cool-skill");
    expect(md).toContain("name: My Cool Skill");
    expect(md).toContain("# My Cool Skill");
  });

  it("POST 400 when name missing", async () => {
    __resetSkillStoreForTests(makeFakeStore());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/agents/skills/personal", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST 401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    __resetSkillStoreForTests(makeFakeStore());
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/agents/skills/personal", {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("PATCH/DELETE /api/agents/skills/personal/[slug]", () => {
  async function importHandler() {
    return await import("./[slug]/route");
  }

  it("PATCH writes new body", async () => {
    const fake = makeFakeStore();
    await fake.write("u1", "alpha", "---\nname: Alpha\n---\nold body");
    __resetSkillStoreForTests(fake);
    const { PATCH } = await importHandler();
    const res = await PATCH(
      new Request("http://localhost/api/agents/skills/personal/alpha", {
        method: "PATCH",
        body: JSON.stringify({ md: "---\nname: Alpha\n---\nnew body" }),
      }),
      { params: Promise.resolve({ slug: "alpha" }) },
    );
    expect(res.status).toBe(200);
    expect(await fake.read("u1", "alpha")).toBe("---\nname: Alpha\n---\nnew body");
  });

  it("DELETE removes the skill", async () => {
    const fake = makeFakeStore();
    await fake.write("u1", "tmp", "---\nname: T\n---\n");
    __resetSkillStoreForTests(fake);
    const { DELETE } = await importHandler();
    const res = await DELETE(
      new Request("http://localhost/api/agents/skills/personal/tmp", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "tmp" }) },
    );
    expect(res.status).toBe(200);
    expect(fake.dump().has("u1::tmp")).toBe(false);
  });

  it("PATCH 401 unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    __resetSkillStoreForTests(makeFakeStore());
    const { PATCH } = await importHandler();
    const res = await PATCH(
      new Request("http://localhost/api/agents/skills/personal/x", {
        method: "PATCH",
        body: JSON.stringify({ md: "x" }),
      }),
      { params: Promise.resolve({ slug: "x" }) },
    );
    expect(res.status).toBe(401);
  });
});
