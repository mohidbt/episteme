// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { signRequest } from "@/lib/agents/sign-request";
import { getThreadMessages } from "./get-thread-messages";

const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;

beforeEach(() => {
  process.env.INHALE_INTERNAL_SECRET = "test-secret-abc";
  process.env.AGENTS_URL = "http://test-agents:8000";
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  if (originalAgentsUrl === undefined) delete process.env.AGENTS_URL;
  else process.env.AGENTS_URL = originalAgentsUrl;
  if (originalSecret === undefined) delete process.env.INHALE_INTERNAL_SECRET;
  else process.env.INHALE_INTERNAL_SECRET = originalSecret;
});

describe("getThreadMessages", () => {
  it("calls FastAPI directly (not the local Next.js API route)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await getThreadMessages("u1", "thread-abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://test-agents:8000/agents/km/state/thread-abc");
    // Must NOT route through the local /api/agents/... loopback.
    expect(String(url)).not.toContain("/api/agents");
  });

  it("forwards signed HMAC headers and reuses signRequest helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await getThreadMessages("u1", "thread-xyz");

    expect(signRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/agents/km/state/thread-xyz",
      body: "",
      userId: "u1",
      llmKey: "",
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-Sig"]).toBe("mock-sig");
    expect(headers["X-Inhale-User-Id"]).toBe("u1");
  });

  it("returns the messages array from the upstream payload", async () => {
    const messages = [
      { id: "m1", role: "user", text: "hello" },
      { id: "m2", role: "assistant", text: "hi" },
    ];
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await getThreadMessages("u1", "thread-abc");
    expect(result).toEqual(messages);
  });

  it("returns [] on non-OK upstream response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await getThreadMessages("u1", "thread-abc");
    expect(result).toEqual([]);
  });

  it("returns [] on fetch failure (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const result = await getThreadMessages("u1", "thread-abc");
    expect(result).toEqual([]);
  });

  it("returns [] when AGENTS_URL is unset", async () => {
    delete process.env.AGENTS_URL;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await getThreadMessages("u1", "thread-abc");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the request after 15s when upstream never responds", { timeout: 20_000 }, async () => {
    vi.useFakeTimers();
    let aborted = false;
    global.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;
    try {
      const done = getThreadMessages("u1", "thread-timeout");
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(done).resolves.toEqual([]);
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
