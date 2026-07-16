// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internal-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/internal-auth")>("@/lib/internal-auth");
  return {
    ...actual,
    getAuthedUserId: vi.fn(),
  };
});

import { getAuthedUserId } from "@/lib/internal-auth";
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
      return out.sort((a, b) => a.slug.localeCompare(b.slug));
    },
    async read(userId, slug) {
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
  };
}

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockResolvedValue({ userId: "u1", viaHmac: false });
});

afterEach(() => {
  __resetSkillStoreForTests();
  vi.restoreAllMocks();
});

describe("GET/POST /api/agents/skills/personal", () => {
  it("GET 401 when unauthenticated", async () => {
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
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

  it("POST creates a new skill with auto-slug + JSON body", async () => {
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
    expect(body.description).toBe("");
    expect(body.instructions).toBe("");
    const stored = fake.dump().get("u1::my-cool-skill");
    expect(stored).toContain('"name": "My Cool Skill"');
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
    vi.mocked(getAuthedUserId).mockResolvedValue(null);
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

  it("GET accepts HMAC-signed agent request", async () => {
    const { internalAuthTestHeaders } = await import(
      "@/__tests__/internal-auth-headers"
    );
    const SECRET = "test-secret-abc";
    process.env.INHALE_INTERNAL_SECRET = SECRET;
    const path = "/api/agents/skills/personal";

    // HMAC path bypasses cookie session — getAuthedUserId is real for this assertion.
    vi.mocked(getAuthedUserId).mockImplementation(async (req) => {
      if (req.headers.get("x-inhale-sig")) return { userId: "agent-u1", viaHmac: true };
      return null;
    });

    __resetSkillStoreForTests(makeFakeStore());
    const { GET } = await import("./route");
    const res = await GET(
      new Request(`http://localhost${path}`, {
        headers: internalAuthTestHeaders({
          secret: SECRET,
          userId: "agent-u1",
          method: "GET",
          path,
        }),
      }),
    );
    expect(res.status).toBe(200);
    delete process.env.INHALE_INTERNAL_SECRET;
  });
});
