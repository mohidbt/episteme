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
import { GET, __resetCache } from "./route";
import { req } from "../../../_test-utils";

const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;

beforeEach(() => {
  process.env.AGENTS_URL = "http://test-agents:8000";
  vi.mocked(getSessionInfo).mockResolvedValue({ userId: "u1", isAnonymous: false });
  __resetCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  if (originalAgentsUrl === undefined) delete process.env.AGENTS_URL;
  else process.env.AGENTS_URL = originalAgentsUrl;
});

const upstreamPayload = {
  tools: [
    { name: "web_search", description: "d", category: "web", gateable: true, default_allowed: true },
    { name: "create_note", description: "d", category: "notes", gateable: true, default_allowed: true },
  ],
};

describe("GET /api/agents/km/tools", () => {
  it("returns upstream tools payload to the caller", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstreamPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await GET(req("/api/agents/km/tools", { method: "GET", cookie: "session=x" }));
    expect(r.status).toBe(200);
    const body = await r.json() as { tools: unknown[] };
    expect(body.tools).toHaveLength(2);
  });

  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await GET(req("/api/agents/km/tools", { method: "GET" }));
    expect(r.status).toBe(401);
  });

  it("forwards HMAC headers from signRequest to upstream fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstreamPayload), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(req("/api/agents/km/tools", { method: "GET", cookie: "session=x" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
    expect(headers["X-Inhale-User-Id"]).toBe("u1");
  });

  it("caches for 60s per user — second call within window does not refetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstreamPayload), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(req("/api/agents/km/tools", { method: "GET", cookie: "session=x" }));
    await GET(req("/api/agents/km/tools", { method: "GET", cookie: "session=x" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GSD-88 — query string bypasses the 60s cache (e.g. ?cb=…)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(upstreamPayload), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(req("/api/agents/km/tools", { method: "GET", cookie: "session=x" }));
    await GET(req("/api/agents/km/tools?cb=1", { method: "GET", cookie: "session=x" }));
    await GET(req("/api/agents/km/tools?cb=2", { method: "GET", cookie: "session=x" }));
    // First call populates cache. Both cache-bust calls MUST hit upstream
    // again so users debugging stale inventory can force a refresh.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns 502 when upstream returns 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("upstream broke", { status: 503 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await GET(req("/api/agents/km/tools", { method: "GET", cookie: "session=x" }));
    expect(r.status).toBe(502);
  });
});
