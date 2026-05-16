import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
      execute: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import { matchRefToPapers } from "../match-ref-to-papers";

const USER_ID = "user-1";
const MATCHED_PAPER_ID = "22222222-2222-2222-2222-222222222222";
const FUZZY_PAPER_ID = "33333333-3333-3333-3333-333333333333";

function stubSelectChain(returns: unknown[][]) {
  const queue = [...returns];
  vi.mocked(db.select).mockImplementation(((..._args: unknown[]) => {
    const rows = queue.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain as never;
  }) as never);
}

function stubExecute(returns: unknown[][]) {
  const queue = [...returns];
  vi.mocked(db.execute).mockImplementation((async () => {
    const rows = queue.shift() ?? [];
    return { rows } as never;
  }) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("matchRefToPapers", () => {
  it("returns paperId + 'doi' when DOI hits user's papers", async () => {
    stubSelectChain([[{ id: MATCHED_PAPER_ID }]]);
    const result = await matchRefToPapers(
      { doi: "10.5/known", title: "ignored" },
      USER_ID,
    );
    expect(result).toEqual({ paperId: MATCHED_PAPER_ID, matchMethod: "doi" });
  });

  it("returns null when DOI present but no user paper has it (no title fallback)", async () => {
    stubSelectChain([[]]);
    const result = await matchRefToPapers(
      { doi: "10.5/missing", title: null },
      USER_ID,
    );
    expect(result).toBeNull();
  });

  it("falls back to title fuzzy when no DOI, returns 'title-fuzzy' on hit", async () => {
    stubExecute([[{ id: FUZZY_PAPER_ID, sim: 0.82 }]]);
    const result = await matchRefToPapers(
      { doi: null, title: "Attention Is All You Need" },
      USER_ID,
    );
    expect(result).toEqual({ paperId: FUZZY_PAPER_ID, matchMethod: "title-fuzzy" });
  });

  it("returns null when fuzzy hit below threshold", async () => {
    stubExecute([[]]);
    const result = await matchRefToPapers(
      { doi: null, title: "Some Paper" },
      USER_ID,
    );
    expect(result).toBeNull();
  });

  it("returns null when neither doi nor title", async () => {
    const result = await matchRefToPapers(
      { doi: null, title: null },
      USER_ID,
    );
    expect(result).toBeNull();
  });

  it("survives pg_trgm missing — returns null, no throw", async () => {
    vi.mocked(db.execute).mockImplementation((async () => {
      throw new Error("operator does not exist: text % text");
    }) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await matchRefToPapers(
      { doi: null, title: "Some Title" },
      USER_ID,
    );
    expect(result).toBeNull();
    warn.mockRestore();
  });
});
