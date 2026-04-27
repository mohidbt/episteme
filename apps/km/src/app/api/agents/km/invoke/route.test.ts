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

describe("POST /api/agents/km/invoke", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(getSessionInfo).mockResolvedValue(null);
    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        body: JSON.stringify({ thread_id: "t1", message: "hello" }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 when user has no API key", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("NO_LLM_KEY"));
    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", message: "hello" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "no_api_key" });
  });

  it("pipes SSE stream through with correct Content-Type", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"token","content":"hi"}\n\ndata: [DONE]\n\n'),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", message: "hello" }),
      }),
    );

    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type") ?? "").toContain("text/event-stream");

    const text = await r.text();
    expect(text).toContain("data: [DONE]");
  });

  it("passes through 403 from upstream FastAPI without downgrading", async () => {
    // Guest user_id case: FastAPI returns 403 with guest_forbidden body.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { error: "guests cannot use agents", code: "guest_forbidden" } }),
        { status: 403 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", message: "hello" }),
      }),
    );

    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.detail.code).toBe("guest_forbidden");
  });

  it("forwards signed X-Inhale-Sig header to upstream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(
      req("/api/agents/km/invoke", {
        method: "POST",
        cookie: "session=x",
        body: JSON.stringify({ thread_id: "t1", message: "hello" }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://test-agents:8000/agents/km/invoke");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test-key");
  });
});
