import { beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticScholarRateLimitError } from "../semantic-scholar";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/citations/enrich-paper", () => ({
  enrichReferenceBatchInDb: vi.fn(),
}));

import { db } from "@/lib/db";
import { enrichReferenceBatchInDb } from "@/lib/citations/enrich-paper";
import { runCitationEnrichmentBatch } from "../enrichment-jobs";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-05-23T12:00:00.000Z");

function orderedLimitResult<T>(rows: T[], onLimit?: (n: number) => void) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async (n: number) => {
            onLimit?.(n);
            return rows.slice(0, n);
          },
        }),
      }),
    }),
  };
}

function limitResult<T>(rows: T[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function terminalWhereResult<T>(rows: T[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}

function updateResult<T>(rows: T[], onSet?: (values: unknown) => void) {
  return {
    set: (values: unknown) => {
      onSet?.(values);
      return {
        where: () => ({
          returning: async () => rows,
        }),
      };
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runCitationEnrichmentBatch", () => {
  it("claims one due job and processes at most five refs", async () => {
    const job = {
      paperId: PAPER_ID,
      status: "queued",
      attempts: 1,
      nextRunAt: NOW,
      lockedUntil: null,
      lastError: null,
      totalRefs: 9,
      enrichedRefs: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const refs = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      title: `ref ${i + 1}`,
      doi: null,
    }));
    const limits: number[] = [];
    const finalSet: unknown[] = [];

    vi.mocked(db.select)
      .mockReturnValueOnce(orderedLimitResult([job]) as never)
      .mockReturnValueOnce(limitResult([{ userId: "u1" }]) as never)
      .mockReturnValueOnce(orderedLimitResult(refs, (n) => limits.push(n)) as never)
      .mockReturnValueOnce(terminalWhereResult([{ n: 9 }]) as never)
      .mockReturnValueOnce(terminalWhereResult([{ n: 4 }]) as never);
    vi.mocked(db.update)
      .mockReturnValueOnce(updateResult([{ ...job, status: "running", attempts: 2 }]) as never)
      .mockReturnValueOnce(updateResult([], (values) => finalSet.push(values)) as never);
    vi.mocked(enrichReferenceBatchInDb).mockResolvedValue(3);

    const result = await runCitationEnrichmentBatch(NOW);

    expect(limits).toEqual([5]);
    expect(enrichReferenceBatchInDb).toHaveBeenCalledWith(
      refs.slice(0, 5),
      "u1",
      { throwOnRateLimit: true },
    );
    expect(result).toMatchObject({ paperId: PAPER_ID, processed: 5, enriched: 3, status: "queued" });
    expect(finalSet[0]).toMatchObject({ status: "queued", enrichedRefs: 5, lastError: null });
  });

  it("backs off and leaves the job queued when Semantic Scholar keeps returning 429", async () => {
    const job = {
      paperId: PAPER_ID,
      status: "queued",
      attempts: 2,
      nextRunAt: NOW,
      lockedUntil: null,
      lastError: null,
      totalRefs: 2,
      enrichedRefs: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const finalSet: unknown[] = [];

    vi.mocked(db.select)
      .mockReturnValueOnce(orderedLimitResult([job]) as never)
      .mockReturnValueOnce(limitResult([{ userId: "u1" }]) as never)
      .mockReturnValueOnce(orderedLimitResult([{ id: 1, title: "ref", doi: null }]) as never);
    vi.mocked(db.update)
      .mockReturnValueOnce(updateResult([{ ...job, status: "running", attempts: 3 }]) as never)
      .mockReturnValueOnce(updateResult([], (values) => finalSet.push(values)) as never);
    vi.mocked(enrichReferenceBatchInDb).mockRejectedValue(
      new SemanticScholarRateLimitError("Semantic Scholar returned 429"),
    );

    const result = await runCitationEnrichmentBatch(NOW);

    expect(result).toMatchObject({ paperId: PAPER_ID, processed: 0, enriched: 0, status: "queued" });
    expect(finalSet[0]).toMatchObject({
      status: "queued",
      lockedUntil: null,
      lastError: "Semantic Scholar returned 429",
    });
    expect((finalSet[0] as { nextRunAt: Date }).nextRunAt.toISOString()).toBe(
      "2026-05-23T12:10:00.000Z",
    );
  });
});
