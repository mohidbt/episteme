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
import { SKILLS } from "@/lib/skills";

function makeFakeStore(seed: Array<[string, string, string]>): SkillStore {
  const data = new Map<string, string>();
  for (const [u, s, content] of seed) data.set(`${u}::${s}`, content);
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
      makeFakeStore([["u1", "my-style", JSON.stringify({ name: "My Style", description: "My style desc", instructions: "Rewrite in my style" })]]),
    );
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agents/skills"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills.length).toBe(SKILLS.length + 1);
    const personal = body.skills.find(
      (s: { slug?: string }) => s.slug === "my-style",
    );
    expect(personal).toMatchObject({
      source: "personal",
      description: "My style desc",
      instruction: "Rewrite in my style",
    });
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

  it("personal skills appear in merged list with instruction from instructions field", async () => {
    __resetSkillStoreForTests(
      makeFakeStore([["u1", "quick-note", JSON.stringify({ name: "Quick Note", description: "Brief notes", instructions: "Write brief notes" })]]),
    );
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agents/skills"));
    const body = await res.json();
    const ps = body.skills.find((s: { slug: string }) => s.slug === "quick-note");
    expect(ps).toBeDefined();
    expect(ps.instruction).toBe("Write brief notes");
    expect(ps.description).toBe("Brief notes");
  });

  it("personal skills fall back to description when instructions are empty", async () => {
    __resetSkillStoreForTests(
      makeFakeStore([["u1", "lazy", JSON.stringify({ name: "Lazy", description: "I am lazy", instructions: "" })]]),
    );
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/agents/skills"));
    const body = await res.json();
    const ps = body.skills.find((s: { slug: string }) => s.slug === "lazy");
    expect(ps.instruction).toBe("I am lazy");
  });
});