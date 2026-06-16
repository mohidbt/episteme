// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/sign-request", () => ({
  signRequest: vi.fn(() => ({
    headers: { "X-Inhale-User-Id": "u1", "X-Inhale-Sig": "mock" },
    ts: "1",
  })),
}));

import { extractPdfPages } from "./pdf-text";

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.AGENTS_URL = "http://test-agents:8000";
  process.env.INHALE_INTERNAL_SECRET = "secret";
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

describe("extractPdfPages timeout", () => {
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
      const done = extractPdfPages("/x.pdf", { userId: "u1" });
      const failed = expect(done).rejects.toThrow(/abort/i);
      await vi.advanceTimersByTimeAsync(15_000);
      await failed;
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
