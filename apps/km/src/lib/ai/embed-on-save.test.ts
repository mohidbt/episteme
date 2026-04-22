import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn(),
}));

import { getDecryptedApiKey } from "@episteme/auth/byok";
import { embedOnSave } from "./embed-on-save";

const originalFetch = global.fetch;
const originalAgentsUrl = process.env.AGENTS_URL;
const originalSecret = process.env.INHALE_INTERNAL_SECRET;

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

describe("embedOnSave", () => {
  it("chunks the markdown and POSTs to /agents/km/embed-note-chunks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ inserted: 1 }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await embedOnSave("note-1", "hello world", "user-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/agents/km/embed-note-chunks");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Inhale-User-Id"]).toBe("user-1");
    expect(headers["X-Inhale-LLM-Key"]).toBe("sk-test-key");
    expect(headers["X-Inhale-Ts"]).toBeDefined();
    expect(headers["X-Inhale-Sig"]).toBeDefined();
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.noteId).toBe("note-1");
    expect(Array.isArray(body.chunks)).toBe(true);
    expect(body.chunks.length).toBeGreaterThan(0);
    expect(body.chunks[0]).toHaveProperty("chunkIdx");
    expect(body.chunks[0]).toHaveProperty("content");
  });

  it("no-ops on empty markdown", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(embedOnSave("note-1", "", "user-1")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows missing BYOK key — no throw, no fetch", async () => {
    vi.mocked(getDecryptedApiKey).mockRejectedValueOnce(new Error("no key"));
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(embedOnSave("note-1", "hello", "user-1")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows upstream HTTP errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("boom", { status: 500 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(embedOnSave("note-1", "hello", "user-1")).resolves.toBeUndefined();
  });

  it("swallows network errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(embedOnSave("note-1", "hello", "user-1")).resolves.toBeUndefined();
  });

  it("uses AGENTS_URL from env", async () => {
    process.env.AGENTS_URL = "http://test-agents:8000";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ inserted: 1 }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await embedOnSave("note-1", "hello", "user-1");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url).startsWith("http://test-agents:8000")).toBe(true);
  });
});
