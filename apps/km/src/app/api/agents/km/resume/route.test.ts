// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));

vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(() => ({
    headers: {
      "X-Inhale-User-Id": "u1",
      "X-Inhale-LLM-Key": "sk-test-key",
      "X-Inhale-Ts": "1234567890",
      "X-Inhale-Sig": "mock-sig",
    },
    ts: "1234567890",
  })),
}));

// Mock the db client so tests can stub agentConfigs rows without a live Postgres.
// The shape mirrors drizzle's chain: db.select({...}).from(table).where(...).limit(N).
const mockAgentConfigRow = {
  current: null as null | {
    modelPreference: string | null;
    enabledSkills: string[] | null;
    approvalRules: Record<string, unknown> | null;
    settingsJson: Record<string, unknown> | null;
  },
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            mockAgentConfigRow.current ? [mockAgentConfigRow.current] : [],
        }),
      }),
    }),
  },
}));

import { getSessionInfo } from "@/lib/auth";
import { getDecryptedApiKey } from "@episteme/auth/byok";
import { signRequest } from "@/lib/agents/sign-request";
import { POST } from "./route";
import { req } from "../../../_test-utils";

const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
  process.env.AGENTS_URL = "http://test-agents:8000";
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
  vi.mocked(getDecryptedApiKey).mockResolvedValue("sk-test-key");
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  if (originalAgentsUrl === undefined) delete process.env.AGENTS_URL;
  else process.env.AGENTS_URL = originalAgentsUrl;
  if (originalSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
  else process.env.INHALE_INTERNAL_SECRET = originalSecret;
});

describe("POST /api/agents/km/resume", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        body: JSON.stringify({ thread_id: "t1", decisions: [] }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 when user has no API key", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    const r = await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", decisions: [] }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "OPENROUTER_KEY_MISSING" });
  });

  it("pipes SSE stream through with correct Content-Type", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"token","content":"resumed"}\n\ndata: [DONE]\n\n'),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", decisions: [{ approved: true }] }),
      }),
    );

    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type") ?? "").toContain("text/event-stream");

    const text = await r.text();
    expect(text).toContain("data: [DONE]");
  });

  it("forwards signed X-Inhale-Sig header to upstream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", decisions: [] }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://test-agents:8000/agents/km/resume");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test-key");
  });
});

// GSD-103 — Phase-1 RED: resume route must read & forward approval_rules +
// enabled_skills (with skill hint merge) so the post-approval continuation
// rebuild of build_km_agent in the agent service uses the same gates the
// initial /invoke turn did. Previously only `permissions` was forwarded; the
// agent fell back to its in-process cache for approvalRules + enabled_skills
// (cold cache after restart silently drops user-saved gates).
describe("POST /api/agents/km/resume — GSD-103 wiring", () => {
  beforeEach(() => {
    mockAgentConfigRow.current = {
      modelPreference: "openai/gpt-4o-mini",
      enabledSkills: ["lit-triage"],
      approvalRules: { delete_paper: "auto", browse_papersets: "require" },
      settingsJson: { permissions: { web_search: false } },
    };
  });

  afterEach(() => {
    mockAgentConfigRow.current = null;
  });

  it("forwards approval_rules to upstream body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", decisions: [] }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const upstreamBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(upstreamBody.approval_rules).toEqual({
      delete_paper: "auto",
      browse_papersets: "require",
    });
  });

  it("forwards enabled_skills (DB value) to upstream body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", decisions: [] }),
      }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const upstreamBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(upstreamBody.enabled_skills).toEqual(["lit-triage"]);
  });

  it("merges body.skill hint into enabled_skills before forward", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({
          thread_id: "t1",
          decisions: [],
          skill: "paper-search",
        }),
      }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const upstreamBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(upstreamBody.enabled_skills).toEqual(["lit-triage", "paper-search"]);
  });

  it("still forwards permissions (regression guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req("/api/agents/km/resume", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", decisions: [] }),
      }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const upstreamBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(upstreamBody.permissions).toEqual({ web_search: false });
  });
});
