import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolvePaperId,
  fetchPaperBatch,
  enrichReferences,
} from "../semantic-scholar";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_PAPER_RESPONSE = {
  paperId: "abc123",
  title: "Attention Is All You Need",
  authors: [
    { name: "Ashish Vaswani", authorId: "auth1" },
    { name: "Noam Shazeer", authorId: "auth2" },
  ],
  year: 2017,
  externalIds: { DOI: "10.5555/3295222.3295349", ArXiv: "1706.03762" },
  abstract: "The dominant sequence transduction models...",
  venue: "NeurIPS",
  citationCount: 50000,
  influentialCitationCount: 8000,
  openAccessPdf: { url: "https://arxiv.org/pdf/1706.03762.pdf" },
  isOpenAccess: true,
  tldr: { text: "A transformer architecture based purely on attention." },
  citationStyles: { bibtex: "@article{vaswani2017attention,...}" },
};

const EXPECTED_FULL_METADATA = {
  paperId: "abc123",
  title: "Attention Is All You Need",
  authors: [
    { name: "Ashish Vaswani", authorId: "auth1" },
    { name: "Noam Shazeer", authorId: "auth2" },
  ],
  year: 2017,
  externalIds: { DOI: "10.5555/3295222.3295349", ArXiv: "1706.03762" },
  abstract: "The dominant sequence transduction models...",
  venue: "NeurIPS",
  citationCount: 50000,
  influentialCitationCount: 8000,
  openAccessPdfUrl: "https://arxiv.org/pdf/1706.03762.pdf",
  isOpenAccess: true,
  tldr: "A transformer architecture based purely on attention.",
  bibtex: "@article{vaswani2017attention,...}",
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// ---------------------------------------------------------------------------
// Task B: New tests (TDD — written before implementation)
// ---------------------------------------------------------------------------

// Test 1: Mapper — mapPaper returns correct PaperMetadata shape
describe("mapPaper (via fetchPaperBatch)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps all fields correctly from a full paper response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, [FULL_PAPER_RESPONSE])
    );
    const results = await fetchPaperBatch(["abc123"]);
    expect(results[0]).toEqual(EXPECTED_FULL_METADATA);
  });
});

// Test 2: Batch-call count — enrichReferences with 3 refs → 3 resolve calls + 1 batch POST
describe("enrichReferences — call counts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("calls resolve 3 times and batch once for 3 refs", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        // batch call
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [FULL_PAPER_RESPONSE, FULL_PAPER_RESPONSE, FULL_PAPER_RESPONSE],
        });
      }
      // resolve call (DOI or search/match)
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ paperId: "abc123" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refs = [
      { id: 1, title: "Paper A", doi: "10.1/a" },
      { id: 2, title: "Paper B", doi: "10.1/b" },
      { id: 3, title: "Paper C", doi: "10.1/c" },
    ];
    const promise = enrichReferences(refs);
    await vi.runAllTimersAsync();
    await promise;

    const calls = fetchMock.mock.calls as [string, RequestInit?][];
    const resolveCalls = calls.filter(([, init]) => !init || init.method !== "POST");
    const batchCalls = calls.filter(([, init]) => init?.method === "POST");

    expect(resolveCalls).toHaveLength(3);
    expect(batchCalls).toHaveLength(1);
  });
});

// Test 3: Chunking — fetchPaperBatch with 501 ids → 2 POST calls
describe("fetchPaperBatch — chunking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes 2 POST calls for 501 ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const ids = Array.from({ length: 501 }, (_, i) => `id${i}`);
    await fetchPaperBatch(ids);

    const postCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
      ([, init]) => init?.method === "POST"
    );
    expect(postCalls).toHaveLength(2);
  });
});

// Test 4: Header conditional — apiKey present → every fetch has x-api-key header
describe("enrichReferences — x-api-key header", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends x-api-key header when apiKey is provided", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [FULL_PAPER_RESPONSE],
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ paperId: "abc123" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refs = [{ id: 1, title: "Paper A", doi: "10.1/a" }];
    const promise = enrichReferences(refs, { apiKey: "test-key" });
    await vi.runAllTimersAsync();
    await promise;

    for (const [, init] of fetchMock.mock.calls as [string, RequestInit?][]) {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["x-api-key"]).toBe("test-key");
    }
  });

  it("does not send x-api-key when no apiKey", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [FULL_PAPER_RESPONSE],
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ paperId: "abc123" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refs = [{ id: 1, title: "Paper A", doi: "10.1/a" }];
    const promise = enrichReferences(refs);
    await vi.runAllTimersAsync();
    await promise;

    for (const [, init] of fetchMock.mock.calls as [string, RequestInit?][]) {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["x-api-key"]).toBeUndefined();
    }
  });
});

// Test 5: Unresolved refs — DOI 404 + empty search → metadata null, skipped from batch
describe("enrichReferences — unresolved refs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns metadata: null for unresolvable ref, skips it from batch", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [],
        });
      }
      // DOI lookup → 404
      if (url.includes("DOI%3A")) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      // search/match → empty data
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const refs = [{ id: 1, title: "Nonexistent Paper", doi: "10.9999/nope" }];
    const promise = enrichReferences(refs);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(1);
    expect(results[0].refId).toBe(1);
    expect(results[0].metadata).toBeNull();

    // batch POST should not have been called (no resolved ids)
    const postCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
      ([, init]) => init?.method === "POST"
    );
    expect(postCalls).toHaveLength(0);
  });
});

// Test 6: Null-safe mapping — missing optional fields → null, no throw
describe("mapPaper — null-safe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps null for missing openAccessPdf, tldr, citationStyles, influentialCitationCount", async () => {
    const minimalPaper = {
      paperId: "min1",
      title: "Minimal Paper",
      authors: [],
      year: 2020,
      externalIds: null,
      abstract: null,
      venue: null,
      citationCount: null,
      // missing: influentialCitationCount, openAccessPdf, isOpenAccess, tldr, citationStyles
    };
    vi.stubGlobal("fetch", mockFetch(200, [minimalPaper]));

    const results = await fetchPaperBatch(["min1"]);
    expect(results[0]).toMatchObject({
      paperId: "min1",
      influentialCitationCount: null,
      openAccessPdfUrl: null,
      isOpenAccess: null,
      tldr: null,
      bibtex: null,
      externalIds: null,
    });
  });
});

// ---------------------------------------------------------------------------
// resolvePaperId
// ---------------------------------------------------------------------------

describe("resolvePaperId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns paperId via DOI lookup when DOI present", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { paperId: "abc123" }));
    const id = await resolvePaperId({ id: 1, title: "T", doi: "10.1/a" });
    expect(id).toBe("abc123");
  });

  it("falls back to search/match when DOI absent", async () => {
    const fetchMock = mockFetch(200, { data: [{ paperId: "xyz789" }] });
    vi.stubGlobal("fetch", fetchMock);
    const id = await resolvePaperId({ id: 1, title: "My Paper", doi: null });
    expect(id).toBe("xyz789");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("search/match");
  });

  it("returns null when DOI 404 and no title", async () => {
    vi.stubGlobal("fetch", mockFetch(404, {}));
    const id = await resolvePaperId({ id: 1, title: null, doi: "10.9999/nope" });
    expect(id).toBeNull();
  });

  it("returns null when search/match returns empty data", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { data: [] }));
    const id = await resolvePaperId({ id: 1, title: "Unknown", doi: null });
    expect(id).toBeNull();
  });
});
