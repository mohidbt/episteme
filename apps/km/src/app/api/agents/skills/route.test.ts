// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

import { getSessionInfo } from "@/lib/auth";
import {
  __resetSkillStoreForTests,
  type SkillStore,
} from "@/lib/skills-store";
import { SKILLS } from "@/lib/skills";

function makeFakeStore(seed: Array<[string, string, string]>): SkillStore {
  const data = new Map<string, string>();
  for (const [u, s, md] of seed) data.set(`${u}::${s}`, md);
  return {
    async list(userId) {
      const out = [];
      for (const [k, v] of data) {
        const [u, slug] = k.split("::");
        if (u !== userId) continue;
        const name = /name:\s*([^\n]+)/.exec(v)?.[1]?.trim() ?? slug;
        out.push({ slug, name, description: "", category: "writing" as const });
      }
      return out;
    },
    async read() {
      return "";
    },
    async write() {},
    async delete() {},
  };
}

beforeEach(() => {
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
});

afterEach(() => {
  __resetSkillStoreForTests();
  vi.restoreAllMocks();
});

describe("GET /api/agents/skills (merged)", () => {
  it("merges system + personal skills", async () => {
    __resetSkillStoreForTests(
      makeFakeStore([["u1", "my-style", "---\nname: My Style\n---\n"]]),
    );
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agents/skills"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills.length).toBe(SKILLS.length + 1);
    const personal = body.skills.find(
      (s: { slug?: string }) => s.slug === "my-style",
    );
    expect(personal).toMatchObject({ source: "personal" });
    expect(
      body.skills.filter((s: { source: string }) => s.source === "system").length,
    ).toBe(SKILLS.length);
  });

  it("falls back to system-only when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    __resetSkillStoreForTests(makeFakeStore([]));
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agents/skills"));
    const body = await res.json();
    expect(body.skills.length).toBe(SKILLS.length);
    expect(body.skills.every((s: { source: string }) => s.source === "system")).toBe(true);
  });
});
