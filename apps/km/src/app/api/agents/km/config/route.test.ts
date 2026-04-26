// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock getSessionInfo before importing route
vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

// Mock drizzle db
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  schema: {},
}));

// Mock sign-request
vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(() => ({
    headers: {
      "X-Inhale-User-Id": "u1",
      "X-Inhale-LLM-Key": "",
      "X-Inhale-Ts": "1234567890",
      "X-Inhale-Sig": "mock-sig",
    },
    ts: "1234567890",
  })),
}));

import { getSessionInfo } from "@/lib/auth";
import { db } from "@/lib/db";
import { signRequest } from "@/lib/agents/sign-request";
import { GET, PATCH } from "./route";
import { req } from "../../_test-utils";

const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
  process.env.AGENTS_URL = "http://test-agents:8000";
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  if (originalAgentsUrl === undefined) delete process.env.AGENTS_URL;
  else process.env.AGENTS_URL = originalAgentsUrl;
  if (originalSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
  else process.env.INHALE_INTERNAL_SECRET = originalSecret;
});

// Helpers to wire up drizzle chainable mock
function mockSelectReturning(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.select).mockReturnValue(chain as never);
  return chain;
}

function mockInsertReturning(rows: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.insert).mockReturnValue(chain as never);
  return chain;
}

function mockUpdateReturning(rows: unknown[]) {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  vi.mocked(db.update).mockReturnValue(chain as never);
  return chain;
}

const defaultConfig = {
  userId: "u1",
  enabledSkills: [],
  attachedMcps: [],
  modelPreference: "google/gemma-4-31b-it:free",
  approvalRules: {},
  skillsMd: "",
  memoryMd: "",
  settingsJson: {},
  updatedAt: new Date(),
};

describe("GET /api/agents/km/config", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await GET(req("/api/agents/km/config", { method: "GET" }));
    expect(r.status).toBe(401);
  });

  it("returns existing config for authenticated user", async () => {
    mockSelectReturning([defaultConfig]);
    const r = await GET(req("/api/agents/km/config", { method: "GET", cookie: "session=x" }));
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body.modelPreference).toBe("google/gemma-4-31b-it:free");
    expect(body.enabledSkills).toEqual([]);
  });

  it("inserts defaults and returns them when no row exists", async () => {
    mockSelectReturning([]);
    mockInsertReturning([defaultConfig]);
    const r = await GET(req("/api/agents/km/config", { method: "GET", cookie: "session=x" }));
    expect(r.status).toBe(200);
    expect(vi.mocked(db.insert)).toHaveBeenCalled();
    const body = await r.json() as Record<string, unknown>;
    expect(body.modelPreference).toBe("google/gemma-4-31b-it:free");
  });
});

describe("PATCH /api/agents/km/config", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await PATCH(
      req("/api/agents/km/config", {
        method: "PATCH",
        body: JSON.stringify({ modelPreference: "gpt-4o" }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 for unknown keys (strict schema)", async () => {
    const r = await PATCH(
      req("/api/agents/km/config", {
        method: "PATCH",
        cookie: "session=x",
        body: JSON.stringify({ unknownField: "bad" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("updates DB and calls downstream with X-Inhale-Sig header", async () => {
    const updated = { ...defaultConfig, modelPreference: "gpt-4o" };
    mockUpdateReturning([updated]);

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await PATCH(
      req("/api/agents/km/config", {
        method: "PATCH",
        cookie: "session=x",
        body: JSON.stringify({ modelPreference: "gpt-4o" }),
      }),
    );
    expect(r.status).toBe(200);
    expect(vi.mocked(db.update)).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBeDefined();
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
  });

  it("still returns 200 when downstream fetch throws", async () => {
    const updated = { ...defaultConfig, modelPreference: "gpt-4o" };
    mockUpdateReturning([updated]);

    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await PATCH(
      req("/api/agents/km/config", {
        method: "PATCH",
        cookie: "session=x",
        body: JSON.stringify({ modelPreference: "gpt-4o" }),
      }),
    );
    expect(r.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
  });
});
