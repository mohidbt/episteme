import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      execute: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import { autoLinkPaperCitations } from "../auto-link";

const PAPER_ID = "11111111-1111-1111-1111-111111111111";
const MATCHED_PAPER_ID = "22222222-2222-2222-2222-222222222222";
const FUZZY_MATCHED_PAPER_ID = "33333333-3333-3333-3333-333333333333";

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
    return chain as never;
  }) as never);
}

// Stub db.execute() to return successive result-sets. pg-style result has
// `.rows`; node-postgres also exposes the array shape. Our code reads .rows
// when available, else falls back to the result itself.
function stubExecute(returns: unknown[][]) {
  const queue = [...returns];
  vi.mocked(db.execute).mockImplementation((async () => {
    const rows = queue.shift() ?? [];
    return { rows } as never;
  }) as never);
}

function stubExecuteThrows(message: string) {
  vi.mocked(db.execute).mockImplementation((async () => {
    throw new Error(message);
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
    // selects:
    //   1) documentReferences for paper
    //   2) papers by doi → matches MATCHED_PAPER_ID
    // execute (pg_trgm fuzzy lookup, called once for the title-only ref):
    //   1) [] → no fuzzy hit, fallback to "reference"
    stubSelectChain([
      [{ userId: "user-1" }],
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
    ]);
    stubExecute([[]]);

    stubInsertSucceeds([1, 1]);

    const result = await autoLinkPaperCitations(PAPER_ID);
    expect(result.linked).toBe(2);

    const insertCalls = vi.mocked(db.insert).mock.calls;
    expect(insertCalls.length).toBe(2);
  });

  it("uses pg_trgm similarity for title fuzzy match above threshold", async () => {
    stubSelectChain([
      [{ userId: "user-1" }],
      [
        {
          id: 201,
          paperId: PAPER_ID,
          doi: null,
          title: "Attention Is All You Need",
          markerIndex: 1,
        },
      ],
    ]);
    // Single fuzzy hit above threshold
    stubExecute([
      [{ id: FUZZY_MATCHED_PAPER_ID, sim: 0.82 }],
    ]);
    stubInsertSucceeds([1]);

    const result = await autoLinkPaperCitations(PAPER_ID);
    expect(result.linked).toBe(1);

    const insertCalls = vi.mocked(db.insert).mock.calls;
    expect(insertCalls.length).toBe(1);
    // db.execute was used (not db.select for fuzzy candidate list)
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1);
  });

  it("falls back to reference when pg_trgm extension missing", async () => {
    stubSelectChain([
      [{ userId: "user-1" }],
      [
        {
          id: 301,
          paperId: PAPER_ID,
          doi: null,
          title: "Some Paper Title",
          markerIndex: 1,
        },
      ],
    ]);
    stubExecuteThrows(
      'operator does not exist: text % text (pg_trgm extension may be missing)',
    );
    stubInsertSucceeds([1]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await autoLinkPaperCitations(PAPER_ID);
    expect(result.linked).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns {linked:0} with warning when paper_citations relation does not exist", async () => {
    stubSelectChain([
      [{ userId: "user-1" }],
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
      [{ userId: "user-1" }],
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
    stubInsertSucceeds([0]);

    const result = await autoLinkPaperCitations(PAPER_ID);
    expect(result.linked).toBe(0);
  });
});
