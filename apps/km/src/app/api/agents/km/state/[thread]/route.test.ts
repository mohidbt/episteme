// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getSessionInfo: vi.fn(),
}));

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
import { signRequest } from "@/lib/agents/sign-request";
import { GET } from "./route";
import { req, params } from "../../../../_test-utils";

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

describe("GET /api/agents/km/state/[thread]", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await GET(
      req("/api/agents/km/state/thread-abc", { method: "GET" }),
      params({ thread: "thread-abc" }),
    );
    expect(r.status).toBe(401);
  });

  it("returns upstream JSON for authenticated user", async () => {
    const statePayload = { todos: [], pending_interrupts: [] };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(statePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await GET(
      req("/api/agents/km/state/thread-abc", { method: "GET", cookie: "session=x" }),
      params({ thread: "thread-abc" }),
    );

    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual(statePayload);
  });

  it("forwards signed X-Inhale-Sig header to upstream with correct URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ todos: [] }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(
      req("/api/agents/km/state/thread-xyz", { method: "GET", cookie: "session=x" }),
      params({ thread: "thread-xyz" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://test-agents:8000/agents/km/state/thread-xyz");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
  });
});
