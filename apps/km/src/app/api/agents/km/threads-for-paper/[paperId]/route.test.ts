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

const PAPER = "00000000-0000-0000-0000-000000000001";

describe("GET /api/agents/km/threads-for-paper/[paperId]", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await GET(
      req(`/api/agents/km/threads-for-paper/${PAPER}`, { method: "GET" }),
      params({ paperId: PAPER }),
    );
    expect(r.status).toBe(401);
  });

  it("returns upstream JSON threads list", async () => {
    const payload = {
      threads: [
        { thread_id: "t2", created_at: "2026-01-03T12:00:00+00:00" },
        { thread_id: "t1", created_at: "2026-01-02T12:00:00+00:00" },
      ],
    };
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const r = await GET(
      req(`/api/agents/km/threads-for-paper/${PAPER}`, {
        method: "GET",
        cookie: "session=x",
      }),
      params({ paperId: PAPER }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(payload);
  });

  it("forwards HMAC headers to upstream agents service", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ threads: [] }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(
      req(`/api/agents/km/threads-for-paper/${PAPER}`, {
        method: "GET",
        cookie: "session=x",
      }),
      params({ paperId: PAPER }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `http://test-agents:8000/agents/km/threads-for-paper/${PAPER}`,
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
  });
});
