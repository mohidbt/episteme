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
});
