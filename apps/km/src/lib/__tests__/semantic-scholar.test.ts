import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchPaperReferences,
  __resetS2LimiterForTests,
} from "../semantic-scholar";

const sampleS2Body = {
  data: [
    {
      citedPaper: {
        paperId: "p1",
        title: "Cited One",
        authors: [{ name: "A. Author" }],
        year: 2020,
        externalIds: { DOI: "10.1/one" },
        abstract: "abs1",
        venue: "Venue1",
        citationCount: 10,
        influentialCitationCount: 2,
        openAccessPdf: { url: "https://oa/1.pdf" },
        tldr: { text: "tldr1" },
      },
    },
  ],
};

describe("fetchPaperReferences", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    __resetS2LimiterForTests();
  });

  it("returns mapped refs array on 200", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(sampleS2Body), { status: 200 }),
    );
    const out = await fetchPaperReferences("10.1234/abc");
    expect(out).toEqual([
      expect.objectContaining({
        paperId: "p1",
        title: "Cited One",
        doi: "10.1/one",
        tldrText: "tldr1",
        openAccessPdfUrl: "https://oa/1.pdf",
      }),
    ]);
  });

  it("returns null on 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("not found", { status: 404 }),
    );
    const out = await fetchPaperReferences("10.1234/missing");
    expect(out).toBeNull();
  });

  it("returns null on 429 without throwing", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );
    const out = await fetchPaperReferences("10.1234/abc");
    expect(out).toBeNull();
  });

  it("returns null on network error without throwing", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("ECONN"));
    const out = await fetchPaperReferences("10.1234/abc");
    expect(out).toBeNull();
  });

  it("spaces 2 concurrent calls ≥1000ms apart (rate limiter)", async () => {
    const callTimes: number[] = [];
    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      callTimes.push(Date.now());
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    const [a, b] = await Promise.all([
      fetchPaperReferences("10.1/aaa"),
      fetchPaperReferences("10.1/bbb"),
    ]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(callTimes).toHaveLength(2);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1000);
  }, 10_000);
});
