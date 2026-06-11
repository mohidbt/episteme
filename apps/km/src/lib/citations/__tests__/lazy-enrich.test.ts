// GSD-74 / GSD-90 — lazy-on-view S2 enrichment.
//
// Verifies:
//   - Only enriches refs with enrichedAt IS NULL AND doi IS NOT NULL.
//   - Successful enrichment stamps enrichedAt + S2 fields.
//   - SemanticScholarRateLimitError preserves work-so-far + returns partial.
//   - GSD-90: respects ≥1000ms gap between ALL S2 calls (cumulative bucket).
//   - GSD-90: batches resolved sids — N refs => 1 fetchPaperBatch call w/ N sids.
//   - GSD-90: chunks at 500 sids/call (600 sids => 2 batch calls).
//   - GSD-90: concurrent invocation for same paperId dedupes in-process.
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

function uniquePaperId(): string {
  // Each test gets a fresh paperId so the in-process inflight mutex doesn't
  // bleed state across tests in the same run.
  return `pid-${Math.random().toString(36).slice(2)}`;
}

function mockRefs(rows: Array<Record<string, unknown>>) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      where: async () => rows,
    }),
  } as never);
}

function paperMeta(paperId: string, title: string | null = null) {
  return {
    paperId,
    title,
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
  };
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
    const result = await enrichRefsForPaperLazily(uniquePaperId(), "u1");
    expect(result).toEqual({ enriched: 0, total: 0 });
    expect(resolvePaperId).not.toHaveBeenCalled();
  });

  it("persists S2 metadata and stamps enrichedAt on success", async () => {
    mockRefs([{ id: 1, title: null, doi: "10.1/abc" }]);
    vi.mocked(resolvePaperId).mockResolvedValue("S2-PAPER-1");
    vi.mocked(fetchPaperBatch).mockResolvedValue([paperMeta("S2-PAPER-1", "Hello")]);

    const result = await enrichRefsForPaperLazily(uniquePaperId(), "u1");
    expect(result.enriched).toBe(1);
    expect(updateSetSpy).toHaveBeenCalledTimes(1);
    const setArg = updateSetSpy.mock.calls[0][0] as { enrichedAt: Date; title: string };
    expect(setArg.enrichedAt).toBeInstanceOf(Date);
    expect(setArg.title).toBe("Hello");
  });

  it("returns partial progress when resolve phase rate-limits and persists nothing for that ref", async () => {
    mockRefs([{ id: 1, title: null, doi: "10.1/abc" }]);
    vi.mocked(resolvePaperId).mockRejectedValue(new SemanticScholarRateLimitError());

    const result = await enrichRefsForPaperLazily(uniquePaperId(), "u1");
    expect(result.enriched).toBe(0);
    // No persistence happened — row left for next panel-open retry.
    expect(updateSetSpy).not.toHaveBeenCalled();
  });

  // GSD-90: keep partial-progress semantics. With multi-ref refs, a mid-resolve
  // 429 must preserve any refs that already resolved AND made it through the
  // phase-B batch.
  it("persists earlier work when resolve phase rate-limits mid-stream", async () => {
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
      const titles: Record<string, string> = { "S2-1": "First", "S2-2": "Second" };
      return ids.map((id) => paperMeta(id, titles[id] ?? null));
    });

    const result = await enrichRefsForPaperLazily(uniquePaperId(), "u1");
    // First two resolved, batch persisted both, then phase-A 429'd on ref 3.
    expect(result.enriched).toBe(2);
    expect(result.total).toBe(3);
    const titles = updateSetSpy.mock.calls.map((c) => (c[0] as { title?: string }).title);
    expect(titles).toContain("First");
    expect(titles).toContain("Second");
  });

  // GSD-90 NEW: rate-limit discipline. Every S2 call must be ≥1000ms after the
  // prior S2 call (cumulative bucket across resolve + batch endpoints).
  it("maintains ≥1000ms gap between every S2 call", async () => {
    mockRefs([
      { id: 1, title: null, doi: "10.1/a" },
      { id: 2, title: null, doi: "10.1/b" },
      { id: 3, title: null, doi: "10.1/c" },
    ]);
    const callTimes: number[] = [];
    vi.mocked(resolvePaperId).mockImplementation(async (ref) => {
      callTimes.push(Date.now());
      return `S2-${ref.id}`;
    });
    vi.mocked(fetchPaperBatch).mockImplementation(async (ids: string[]) => {
      callTimes.push(Date.now());
      return ids.map((id) => paperMeta(id));
    });

    await enrichRefsForPaperLazily(uniquePaperId(), "u1");

    expect(callTimes.length).toBeGreaterThanOrEqual(4); // 3 resolve + 1 batch
    for (let i = 1; i < callTimes.length; i++) {
      const gap = callTimes[i] - callTimes[i - 1];
      expect(gap).toBeGreaterThanOrEqual(1000);
    }
  }, 15_000);

  // GSD-90 NEW: 5 refs => exactly ONE fetchPaperBatch call with all 5 sids.
  it("batches all resolved sids into a single fetchPaperBatch call", async () => {
    mockRefs(
      Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: null, doi: `10.1/${i}` })),
    );
    vi.mocked(resolvePaperId).mockImplementation(async (ref) => `S2-${ref.id}`);
    vi.mocked(fetchPaperBatch).mockImplementation(async (ids: string[]) =>
      ids.map((id) => paperMeta(id)),
    );

    await enrichRefsForPaperLazily(uniquePaperId(), "u1");

    expect(fetchPaperBatch).toHaveBeenCalledTimes(1);
    const firstCallArgs = vi.mocked(fetchPaperBatch).mock.calls[0][0];
    expect(firstCallArgs).toHaveLength(5);
  }, 15_000);

  // GSD-90 NEW: 600 sids => 2 fetchPaperBatch calls (chunks of 500).
  // Uses zero sleep override via skipping sleep — we drive 600 refs but only
  // assert on batch call shape, not timing (would take 600s+).
  it("chunks resolved sids at 500 per fetchPaperBatch call", async () => {
    // Construct 600 refs; resolvePaperId resolves all instantly.
    // To keep test runtime reasonable, stub resolvePaperId to return fast and
    // accept that this test will sleep ~600 * 1.1s = too long. Instead use
    // fake timers so we can fast-forward.
    vi.useFakeTimers();
    try {
      mockRefs(
        Array.from({ length: 600 }, (_, i) => ({
          id: i + 1,
          title: null,
          doi: `10.1/${i}`,
        })),
      );
      vi.mocked(resolvePaperId).mockImplementation(async (ref) => `S2-${ref.id}`);
      vi.mocked(fetchPaperBatch).mockImplementation(async (ids: string[]) =>
        ids.map((id) => paperMeta(id)),
      );

      const promise = enrichRefsForPaperLazily(uniquePaperId(), "u1");
      // Drain all pending timers (sleeps between calls).
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.enriched).toBe(600);
      expect(fetchPaperBatch).toHaveBeenCalledTimes(2);
      const firstChunk = vi.mocked(fetchPaperBatch).mock.calls[0][0];
      const secondChunk = vi.mocked(fetchPaperBatch).mock.calls[1][0];
      expect(firstChunk).toHaveLength(500);
      expect(secondChunk).toHaveLength(100);
    } finally {
      vi.useRealTimers();
    }
  });

  // GSD-90 NEW: concurrent invocation for same paperId returns immediately
  // for the second caller (in-process dedup).
  it("dedupes concurrent invocations for the same paperId", async () => {
    const paperId = uniquePaperId();
    mockRefs([{ id: 1, title: null, doi: "10.1/a" }]);
    let resolveStarted = 0;
    vi.mocked(resolvePaperId).mockImplementation(async () => {
      resolveStarted++;
      await new Promise((r) => setTimeout(r, 50));
      return "S2-1";
    });
    vi.mocked(fetchPaperBatch).mockResolvedValue([paperMeta("S2-1")]);

    // First call: real work. Second call (parallel): should return early.
    const first = enrichRefsForPaperLazily(paperId, "u1");
    const second = enrichRefsForPaperLazily(paperId, "u1");

    const secondResult = await second;
    // Second resolved before first finished -> didn't do any work.
    expect(secondResult).toEqual({ enriched: 0, total: 0 });

    const firstResult = await first;
    expect(firstResult.enriched).toBe(1);

    // resolvePaperId only called once (by the first invocation).
    expect(resolveStarted).toBe(1);
  }, 15_000);
});
