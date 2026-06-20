// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/openrouter-key", () => ({
  getOrApiKey: vi.fn(),
  OpenRouterKeyMissing: class OpenRouterKeyMissing extends Error {
    constructor() {
      super("OpenRouterKeyMissing");
      this.name = "OpenRouterKeyMissing";
    }
  },
  OpenRouterTrialExhausted: class OpenRouterTrialExhausted extends Error {
    constructor() {
      super("OpenRouterTrialExhausted");
      this.name = "OpenRouterTrialExhausted";
    }
  },
}));

import { getOrApiKey, OpenRouterTrialExhausted } from "@/lib/openrouter-key";
import { POST } from "./route";
import { __resetRateLimitForTests } from "@/lib/ai-rate-limit";
import {
  createAnonTestUser,
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../_test-utils";

let u: TestUser;
let anon: TestUser;
const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;
const originalSharedKey = process.env.EPISTEME_SHARED_LLM_KEY;

beforeAll(async () => {
  u = await createTestUser();
  anon = await createAnonTestUser();
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(anon.id);
});

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
  process.env.AGENTS_URL = "http://test-agents:8000";
  vi.mocked(getOrApiKey).mockResolvedValue("sk-test-key");
  __resetRateLimitForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  if (originalAgentsUrl === undefined) delete process.env.AGENTS_URL;
  else process.env.AGENTS_URL = originalAgentsUrl;
  if (originalSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
  else process.env.INHALE_INTERNAL_SECRET = originalSecret;
  if (originalSharedKey === undefined) delete process.env.EPISTEME_SHARED_LLM_KEY;
  else process.env.EPISTEME_SHARED_LLM_KEY = originalSharedKey;
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
    const { OpenRouterKeyMissing } = await import("@/lib/openrouter-key");
    vi.mocked(getOrApiKey).mockRejectedValue(new OpenRouterKeyMissing());
    const r = await POST(
      req("/api/ai/chat", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ question: "hi", history: [] }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "OPENROUTER_KEY_MISSING" });
  });

  // GSD-132: upstream 402 → trial_exhausted via streamPassthrough.
  it("402 trial_exhausted when upstream returns 402", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("payment required", { status: 402 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await POST(
      req("/api/ai/chat", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ question: "hi", history: [] }),
      }),
    );
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "trial_exhausted" });
  });

  // GSD-132: getOrApiKey itself throws OpenRouterTrialExhausted → 402.
  it("402 trial_exhausted when getOrApiKey throws OpenRouterTrialExhausted", async () => {
    vi.mocked(getOrApiKey).mockRejectedValue(new OpenRouterTrialExhausted());
    const r = await POST(
      req("/api/ai/chat", {
        method: "POST",
        cookie: u.cookie,
        body: JSON.stringify({ question: "hi", history: [] }),
      }),
    );
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "trial_exhausted" });
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

  describe("anonymous user", () => {
    it("502 agent_unavailable when shared key env is missing", async () => {
      delete process.env.EPISTEME_SHARED_LLM_KEY;
      const r = await POST(
        req("/api/ai/chat", {
          method: "POST",
          cookie: anon.cookie,
          body: JSON.stringify({ question: "hi", history: [] }),
        }),
      );
      expect(r.status).toBe(502);
      expect(await r.json()).toEqual({ error: "agent_unavailable" });
    });

    it("uses EPISTEME_SHARED_LLM_KEY (not BYOK) when below caps", async () => {
      process.env.EPISTEME_SHARED_LLM_KEY = "shared-anon-key";
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("data: [DONE]\n\n", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      await POST(
        req("/api/ai/chat", {
          method: "POST",
          cookie: anon.cookie,
          body: JSON.stringify({ question: "hi", history: [] }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers["X-Inhale-LLM-Key"]).toBe("shared-anon-key");
      expect(headers["X-Inhale-LLM-Key"]).not.toBe("sk-test-key");
    });

    it("413 when body exceeds 16KB", async () => {
      process.env.EPISTEME_SHARED_LLM_KEY = "shared-anon-key";
      const big = "x".repeat(16 * 1024 + 1);
      const r = await POST(
        req("/api/ai/chat", {
          method: "POST",
          cookie: anon.cookie,
          body: JSON.stringify({ question: big, history: [] }),
        }),
      );
      expect(r.status).toBe(413);
      expect(await r.json()).toEqual({ error: "payload_too_large" });
    });

    it("429 with retryAfter on the 6th request in 60s from same IP", async () => {
      process.env.EPISTEME_SHARED_LLM_KEY = "shared-anon-key";
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("data: [DONE]\n\n", { status: 200 }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const make = () =>
        POST(
          req("/api/ai/chat", {
            method: "POST",
            cookie: anon.cookie,
            headers: { "x-forwarded-for": "9.9.9.9" },
            body: JSON.stringify({ question: "hi", history: [] }),
          }),
        );

      for (let i = 0; i < 5; i++) {
        const r = await make();
        expect(r.status).toBe(200);
      }
      const r = await make();
      expect(r.status).toBe(429);
      const j = (await r.json()) as { error: string; retryAfter: number };
      expect(j.error).toBe("rate_limited");
      expect(typeof j.retryAfter).toBe("number");
      expect(j.retryAfter).toBeGreaterThan(0);
    });

    it("masks upstream errors so leaked secrets do not reach the client", async () => {
      process.env.EPISTEME_SHARED_LLM_KEY = "shared-anon-key";
      const leaked = "sk-or-fake-secret-1234";
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(`upstream auth failed: ${leaked}`, { status: 401 }),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const r = await POST(
        req("/api/ai/chat", {
          method: "POST",
          cookie: anon.cookie,
          body: JSON.stringify({ question: "hi", history: [] }),
        }),
      );
      expect(r.status).toBe(502);
      const text = await r.text();
      expect(text).not.toContain(leaked);
      expect(JSON.parse(text)).toEqual({ error: "agent_unavailable" });
    });
  });
});
