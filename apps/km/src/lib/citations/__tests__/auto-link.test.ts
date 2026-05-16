import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import { autoLinkPaperCitations } from "../auto-link";

const PAPER_ID = "11111111-1111-1111-1111-111111111111";
const MATCHED_PAPER_ID = "22222222-2222-2222-2222-222222222222";

type SelectReturn = unknown[];

// Stub a chain like: db.select().from(table).where(...).limit(N) → rows.
function stubSelectChain(returns: SelectReturn[]) {
  const queue = [...returns];
  vi.mocked(db.select).mockImplementation(((..._args: unknown[]) => {
    const rows = queue.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
      then: (cb: (v: unknown) => unknown) => Promise.resolve(rows).then(cb),
    };
    // Make awaiting the builder itself work without .limit()
    return chain as never;
  }) as never);
}

function stubInsertSucceeds(insertedCounts: number[]) {
  const queue = [...insertedCounts];
  vi.mocked(db.insert).mockImplementation(((..._args: unknown[]) => {
    const n = queue.shift() ?? 0;
    return {
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () =>
            Promise.resolve(Array.from({ length: n }, (_, i) => ({ id: i + 1 }))),
        }),
      }),
    } as never;
  }) as never);
}

function stubInsertThrows(message: string) {
  vi.mocked(db.insert).mockImplementation(((..._args: unknown[]) => {
    return {
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.reject(new Error(message)),
        }),
      }),
    } as never;
  }) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("autoLinkPaperCitations", () => {
  it("emits doi match for ref with matching DOI, fuzzy/fallback for ref without DOI", async () => {
    // 1st select: documentReferences for paper
    // 2nd select: papers by doi (matches MATCHED_PAPER_ID)
    // 3rd select: papers by title (no match) → triggers fuzzy candidate scan
    // 4th select: papers candidate list for fuzzy (no candidates) → fallback to reference
    stubSelectChain([
      [
        {
          id: 101,
          paperId: PAPER_ID,
          doi: "10.5/known",
          title: "Known Title",
          markerIndex: 1,
        },
        {
          id: 102,
          paperId: PAPER_ID,
          doi: null,
          title: "Some Untitled Paper",
          markerIndex: 2,
        },
      ],
      [{ id: MATCHED_PAPER_ID, doi: "10.5/known", title: "Known Title" }],
      [], // fuzzy candidate scan — no candidates
    ]);

    stubInsertSucceeds([1, 1]);

    const result = await autoLinkPaperCitations(PAPER_ID);
    expect(result.linked).toBe(2);

    // Inspect what was inserted
    const insertCalls = vi.mocked(db.insert).mock.calls;
    expect(insertCalls.length).toBe(2);
  });

  it("returns {linked:0} with warning when paper_citations relation does not exist", async () => {
    stubSelectChain([
      [
        {
          id: 101,
          paperId: PAPER_ID,
          doi: "10.5/known",
          title: "Known Title",
          markerIndex: 1,
        },
      ],
      [{ id: MATCHED_PAPER_ID, doi: "10.5/known", title: "Known Title" }],
    ]);

    stubInsertThrows('relation "paper_citations" does not exist');
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await autoLinkPaperCitations(PAPER_ID);
    expect(result.linked).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("idempotent: second run inserts 0 thanks to ON CONFLICT", async () => {
    stubSelectChain([
      [
        {
          id: 101,
          paperId: PAPER_ID,
          doi: "10.5/known",
          title: "Known Title",
          markerIndex: 1,
        },
      ],
      [{ id: MATCHED_PAPER_ID, doi: "10.5/known", title: "Known Title" }],
    ]);
    stubInsertSucceeds([0]); // ON CONFLICT DO NOTHING → returning [] → 0 new rows

    const result = await autoLinkPaperCitations(PAPER_ID);
    expect(result.linked).toBe(0);
  });
});
