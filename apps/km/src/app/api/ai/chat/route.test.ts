// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));

import { getDecryptedApiKey } from "@episteme/auth/byok";
import { POST } from "./route";
import { createTestUser, deleteTestUser, req, type TestUser } from "../../_test-utils";

let u: TestUser;
const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;

beforeAll(async () => {
  u = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(u.id);
});

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
  process.env.AGENTS_URL = "http://test-agents:8000";
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

describe("POST /api/ai/chat", () => {
  it("401 when no session cookie", async () => {
    const r = await POST(
      req("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({ question: "hi", history: [] }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it("400 when user has no BYOK key configured", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValue(new Error("no key"));
    const r = await POST(
      req("/api/ai/chat", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ question: "hi", history: [] }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "add_openrouter_key" });
  });

  it("proxies body to AGENTS_URL/agents/km/chat with signed headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const body = JSON.stringify({ question: "what is X", history: [] });
    await POST(
      req("/api/ai/chat", {
        method: "POST",
        cookie: u.cookie,
        body,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://test-agents:8000/agents/km/chat");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-User-Id"]).toBe(u.id);
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test-key");
    expect(headers["X-Inhale-Ts"]).toBeDefined();
    expect(headers["X-Inhale-Sig"]).toBeDefined();
    expect(init.body).toBe(body);
  });

  it("returns SSE stream on success", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"token","content":"hi"}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(stream, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/ai/chat", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ question: "hi", history: [] }),
      }),
    );

    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type") ?? "").toContain("text/event-stream");
  });

  it("passes through upstream error status on 500", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("upstream boom", { status: 500 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await POST(
      req("/api/ai/chat", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ question: "hi", history: [] }),
      }),
    );
    expect(r.status).toBe(500);
  });
});
