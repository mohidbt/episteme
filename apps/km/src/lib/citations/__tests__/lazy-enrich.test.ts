// GSD-74 — lazy-on-view S2 enrichment. Verifies:
//   - Only enriches refs with enrichedAt IS NULL AND doi IS NOT NULL.
//   - Successful enrichment stamps enrichedAt + S2 fields.
//   - SemanticScholarRateLimitError is swallowed; rows left as-is so next
//     panel-open retries.
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSetSpy = vi.fn();

vi.mock("@/lib/db", () => {
  const updateChain = {
    set: (vals: unknown) => {
      updateSetSpy(vals);
      return { where: () => Promise.resolve() };
    },
  };
  return {
    db: {
      select: vi.fn(),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("@episteme/auth/byok", () => ({
  getUserS2Key: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/citations/semantic-scholar", async () => {
  const actual = await vi.importActual<typeof import("@/lib/citations/semantic-scholar")>(
    "@/lib/citations/semantic-scholar",
  );
  return {
    ...actual,
    resolvePaperId: vi.fn(),
    fetchPaperBatch: vi.fn(),
  };
});

import { db } from "@/lib/db";
import {
  resolvePaperId,
  fetchPaperBatch,
  SemanticScholarRateLimitError,
} from "@/lib/citations/semantic-scholar";
import { enrichRefsForPaperLazily } from "../lazy-enrich";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";

function mockRefs(rows: Array<Record<string, unknown>>) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      where: async () => rows,
    }),
  } as never);
}

beforeEach(() => {
  vi.mocked(resolvePaperId).mockReset();
  vi.mocked(fetchPaperBatch).mockReset();
  updateSetSpy.mockReset();
  vi.mocked(db.select).mockReset();
  vi.mocked(db.update).mockClear();
});

describe("enrichRefsForPaperLazily", () => {
  it("no-ops when there are no un-enriched refs with DOIs", async () => {
    mockRefs([]);
    const result = await enrichRefsForPaperLazily(PAPER_ID, "u1");
    expect(result).toEqual({ enriched: 0, total: 0 });
    expect(resolvePaperId).not.toHaveBeenCalled();
  });

  it("persists S2 metadata and stamps enrichedAt on success", async () => {
    mockRefs([{ id: 1, title: null, doi: "10.1/abc" }]);
    vi.mocked(resolvePaperId).mockResolvedValue("S2-PAPER-1");
    vi.mocked(fetchPaperBatch).mockResolvedValue([
      {
        paperId: "S2-PAPER-1",
        title: "Hello",
        authors: [{ name: "Ada" }],
        year: 2024,
        externalIds: { DOI: "10.1/abc" },
        abstract: "abs",
        venue: "ICML",
        citationCount: 42,
        influentialCitationCount: 5,
        openAccessPdfUrl: null,
        isOpenAccess: null,
        tldr: null,
        bibtex: null,
      },
    ]);

    const result = await enrichRefsForPaperLazily(PAPER_ID, "u1");
    expect(result.enriched).toBe(1);
    expect(updateSetSpy).toHaveBeenCalledTimes(1);
    const setArg = updateSetSpy.mock.calls[0][0] as { enrichedAt: Date; title: string };
    expect(setArg.enrichedAt).toBeInstanceOf(Date);
    expect(setArg.title).toBe("Hello");
  });

  it("swallows SemanticScholarRateLimitError and leaves enrichedAt NULL", async () => {
    mockRefs([{ id: 1, title: null, doi: "10.1/abc" }]);
    vi.mocked(resolvePaperId).mockRejectedValue(new SemanticScholarRateLimitError());

    const result = await enrichRefsForPaperLazily(PAPER_ID, "u1");
    expect(result.enriched).toBe(0);
    // No persistence happened — row left for next panel-open retry.
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  // GSD-74 round 3: partial-progress on mid-batch rate-limit. With 76 free-tier
  // refs the chunk-end Promise.all loses ALL work if the batch fetch rate-limits.
  // Each successfully-resolved+fetched ref must persist before continuing so a
  // 429 mid-stream doesn't wipe partial progress.
  it("persists per-ref incrementally so a mid-batch rate-limit preserves earlier work", async () => {
    mockRefs([
      { id: 1, title: null, doi: "10.1/a" },
      { id: 2, title: null, doi: "10.1/b" },
      { id: 3, title: null, doi: "10.1/c" },
    ]);
    vi.mocked(resolvePaperId)
      .mockResolvedValueOnce("S2-1")
      .mockResolvedValueOnce("S2-2")
      .mockRejectedValueOnce(new SemanticScholarRateLimitError());
    vi.mocked(fetchPaperBatch).mockImplementation(async (ids: string[]) => {
      // Per-ref incremental fetch: each call gets one ID.
      const titles: Record<string, string> = { "S2-1": "First", "S2-2": "Second" };
      return ids.map((id) => ({
        paperId: id,
        title: titles[id] ?? null,
        authors: [],
        year: 2024,
        externalIds: null,
        abstract: null,
        venue: null,
        citationCount: null,
        influentialCitationCount: null,
        openAccessPdfUrl: null,
        isOpenAccess: null,
        tldr: null,
        bibtex: null,
      }));
    });

    const result = await enrichRefsForPaperLazily(PAPER_ID, "u1");
    // First two refs resolved + fetched + persisted before the 3rd 429'd.
    expect(result.enriched).toBe(2);
    expect(result.total).toBe(3);
    const titles = updateSetSpy.mock.calls.map((c) => (c[0] as { title?: string }).title);
    expect(titles).toContain("First");
    expect(titles).toContain("Second");
  });
});
