import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "@/lib/db";
import {
  checkOpenRouterFallbackResponse,
  classifyProviderError,
  recordAndMaybeAlert,
} from "@/lib/key-health";

const execMock = db.execute as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-06-02T12:00:00.000Z");

function rowResult(opts: {
  hit_count: number;
  first_seen_at: Date;
  last_alerted_at: Date | null;
}) {
  // postgres-js driver returns rows directly as an array, not { rows: [...] }.
  return [
    {
      id: "00000000-0000-0000-0000-000000000001",
      hit_count: opts.hit_count,
      first_seen_at: opts.first_seen_at,
      last_seen_at: NOW,
      last_alerted_at: opts.last_alerted_at,
    },
  ];
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
let fetchResponseStatus = 200;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  execMock.mockReset();
  process.env.RESEND_API_KEY = "re_test_123";
  process.env.ALERT_EMAIL_TO = "alerts@example.com";
  fetchResponseStatus = 200;
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ id: "msg_test" }), {
      status: fetchResponseStatus,
      headers: { "content-type": "application/json" },
    }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_EMAIL_TO;
});

describe("classifyProviderError", () => {
  it("maps 401 -> key_invalid", () => {
    expect(classifyProviderError(401, "invalid api key")).toBe("key_invalid");
  });
  it("maps 402 -> key_exhausted", () => {
    expect(classifyProviderError(402, "insufficient_quota")).toBe("key_exhausted");
  });
  it("maps 403 + quota text -> key_exhausted", () => {
    expect(classifyProviderError(403, "insufficient credits")).toBe(
      "key_exhausted",
    );
  });
  it("maps 403 non-quota -> null", () => {
    expect(classifyProviderError(403, "forbidden region")).toBeNull();
  });
  it("maps 429 -> key_rate_limited", () => {
    expect(classifyProviderError(429, "rate")).toBe("key_rate_limited");
  });
  it("maps 400 -> null", () => {
    expect(classifyProviderError(400, "")).toBeNull();
  });
  it("maps 500 -> null", () => {
    expect(classifyProviderError(500, "")).toBeNull();
  });
  it("maps 200 -> null", () => {
    expect(classifyProviderError(200, "")).toBeNull();
  });
});

describe("recordAndMaybeAlert", () => {
  it("first-hit key_invalid sends email + marks alerted", async () => {
    execMock
      .mockResolvedValueOnce(
        rowResult({ hit_count: 1, first_seen_at: NOW, last_alerted_at: null }) as never,
      )
      .mockResolvedValueOnce([] as never);

    const sent = await recordAndMaybeAlert({
      provider: "openrouter",
      envVar: "EPISTEME_SHARED_LLM_KEY",
      reason: "key_invalid",
      sampleError: "401",
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toEqual(["alerts@example.com"]);
    expect(body.subject).toContain("openrouter");
    expect(body.subject).toContain("key_invalid");
    expect(body.subject).toContain("EPISTEME_SHARED_LLM_KEY");
    // UPSERT statement first, mark-alerted UPDATE second.
    expect(execMock).toHaveBeenCalledTimes(2);
    const sqlText = (call: unknown): string => {
      const chunks =
        (call as { queryChunks?: Array<string | { value?: string[] }> })
          .queryChunks ?? [];
      return chunks
        .map((c) =>
          typeof c === "string"
            ? c
            : (c as { value?: string[] }).value?.join("") ?? "",
        )
        .join("");
    };
    const upsertSql = sqlText(execMock.mock.calls[0][0]);
    expect(upsertSql).toContain("ON CONFLICT");
    expect(upsertSql).toContain("cleared_at IS NULL");
    const updateSql = sqlText(execMock.mock.calls[1][0]);
    expect(updateSql).toContain("last_alerted_at");
  });

  it("dedups within the hour — no email, no mark-alerted UPDATE", async () => {
    execMock.mockResolvedValueOnce(
      rowResult({
        hit_count: 4,
        first_seen_at: new Date(NOW.getTime() - 30 * 60_000),
        last_alerted_at: new Date(NOW.getTime() - 20 * 60_000),
      }),
    );

    const sent = await recordAndMaybeAlert({
      provider: "openrouter",
      envVar: "EPISTEME_SHARED_LLM_KEY",
      reason: "key_invalid",
      sampleError: "401",
    });

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("re-alerts after the dedup hour window expires", async () => {
    execMock
      .mockResolvedValueOnce(
        rowResult({
          hit_count: 12,
          first_seen_at: new Date(NOW.getTime() - 3 * 3600_000),
          last_alerted_at: new Date(NOW.getTime() - 2 * 3600_000),
        }),
      )
      .mockResolvedValueOnce([]);

    const sent = await recordAndMaybeAlert({
      provider: "openrouter",
      envVar: "EPISTEME_SHARED_LLM_KEY",
      reason: "key_invalid",
      sampleError: "401",
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("key_rate_limited below threshold (4 hits) does not alert", async () => {
    execMock.mockResolvedValueOnce(
      rowResult({
        hit_count: 4,
        first_seen_at: new Date(NOW.getTime() - 2 * 60_000),
        last_alerted_at: null,
      }),
    );

    const sent = await recordAndMaybeAlert({
      provider: "openrouter",
      envVar: "EPISTEME_SHARED_LLM_KEY",
      reason: "key_rate_limited",
      sampleError: "429",
    });

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("key_rate_limited at threshold (5 hits within window) alerts", async () => {
    execMock
      .mockResolvedValueOnce(
        rowResult({
          hit_count: 5,
          first_seen_at: new Date(NOW.getTime() - 4 * 60_000),
          last_alerted_at: null,
        }),
      )
      .mockResolvedValueOnce([]);

    const sent = await recordAndMaybeAlert({
      provider: "openrouter",
      envVar: "EPISTEME_SHARED_LLM_KEY",
      reason: "key_rate_limited",
      sampleError: "429",
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no RESEND_API_KEY -> records to DB but no email; no mark-alerted UPDATE", async () => {
    delete process.env.RESEND_API_KEY;
    execMock.mockResolvedValueOnce(
      rowResult({ hit_count: 1, first_seen_at: NOW, last_alerted_at: null }),
    );

    const sent = await recordAndMaybeAlert({
      provider: "openrouter",
      envVar: "EPISTEME_SHARED_LLM_KEY",
      reason: "key_invalid",
      sampleError: "401",
    });

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("Resend HTTP 500 leaves last_alerted_at unmarked for retry", async () => {
    fetchResponseStatus = 500;
    execMock.mockResolvedValueOnce(
      rowResult({ hit_count: 1, first_seen_at: NOW, last_alerted_at: null }),
    );

    const sent = await recordAndMaybeAlert({
      provider: "openrouter",
      envVar: "EPISTEME_SHARED_LLM_KEY",
      reason: "key_invalid",
      sampleError: "401",
    });

    expect(sent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when DB execute rejects", async () => {
    execMock.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordAndMaybeAlert({
        provider: "openrouter",
        envVar: "EPISTEME_SHARED_LLM_KEY",
        reason: "key_invalid",
        sampleError: "401",
      }),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkOpenRouterFallbackResponse", () => {
  beforeEach(() => {
    process.env.EPISTEME_SHARED_LLM_KEY = "shared-env-key";
    process.env.OPENROUTER_API_KEY = "server-env-key";
    execMock.mockResolvedValue(
      rowResult({ hit_count: 1, first_seen_at: NOW, last_alerted_at: null }),
    );
  });

  afterEach(() => {
    delete process.env.EPISTEME_SHARED_LLM_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it("ok response — no-op", () => {
    const res = new Response("", { status: 200 });
    checkOpenRouterFallbackResponse({
      envVar: "EPISTEME_SHARED_LLM_KEY",
      apiKey: "shared-env-key",
      response: res,
    });
    expect(execMock).not.toHaveBeenCalled();
  });

  it("BYOK key 401 — no notify even on failure", () => {
    const res = new Response("", { status: 401 });
    checkOpenRouterFallbackResponse({
      envVar: "EPISTEME_SHARED_LLM_KEY",
      apiKey: "user-byok-key-different",
      response: res,
    });
    expect(execMock).not.toHaveBeenCalled();
  });

  it("fallback env key 402 — schedules notifier", async () => {
    const res = new Response("insufficient_quota", { status: 402 });
    checkOpenRouterFallbackResponse({
      envVar: "EPISTEME_SHARED_LLM_KEY",
      apiKey: "shared-env-key",
      response: res,
    });
    // Allow the microtask chain (clone().text().then) to flush.
    await vi.waitFor(() => expect(execMock).toHaveBeenCalled());
  });
});
