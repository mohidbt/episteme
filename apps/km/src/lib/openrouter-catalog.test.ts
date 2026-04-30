import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCatalogCacheForTests,
  fetchModelCatalog,
} from "./openrouter-catalog";

const SAMPLE = {
  models: [
    { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
    { id: "google/gemma-4-26b-a4b-it", name: "Gemma" },
  ],
  fetched_at: "2026-04-26T10:00:00.000Z",
};

function mockFetchOnce(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response);
}

describe("fetchModelCatalog", () => {
  beforeEach(() => {
    _resetCatalogCacheForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches from /api/openrouter/catalog and returns models + fetchedAt", async () => {
    const fetchMock = mockFetchOnce(SAMPLE);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchModelCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/openrouter/catalog",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.models).toHaveLength(2);
    expect(result.models[0].id).toBe("openai/gpt-4o-mini");
    expect(result.fetchedAt).toBe(SAMPLE.fetched_at);
  });

  it("caches subsequent calls within 5 minutes (single fetch)", async () => {
    const fetchMock = mockFetchOnce(SAMPLE);
    vi.stubGlobal("fetch", fetchMock);

    await fetchModelCatalog();
    await fetchModelCatalog();
    await fetchModelCatalog();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache after 5 minute TTL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => SAMPLE } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...SAMPLE, fetched_at: "2026-04-26T11:00:00.000Z" }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await fetchModelCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 4 minutes later — still cached.
    vi.advanceTimersByTime(4 * 60 * 1000);
    await fetchModelCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 6 minutes total — past TTL.
    vi.advanceTimersByTime(2 * 60 * 1000 + 1);
    const next = await fetchModelCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(next.fetchedAt).toBe("2026-04-26T11:00:00.000Z");
  });

  it("dedupes concurrent requests into a single fetch", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const p1 = fetchModelCatalog();
    const p2 = fetchModelCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, status: 200, json: async () => SAMPLE } as Response);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it("propagates fetch errors and does not cache them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => SAMPLE } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchModelCatalog()).rejects.toThrow();
    // Failure not cached — next call re-fetches.
    const ok = await fetchModelCatalog();
    expect(ok.models).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
