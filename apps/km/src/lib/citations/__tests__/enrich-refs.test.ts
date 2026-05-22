import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "@/lib/db";
import { enrichRefsWithPaperMatchAndEdges } from "../enrich-refs";

const USER_ID = "user-1";

function stubExecute(queue: unknown[][]) {
  const q = [...queue];
  vi.mocked(db.execute).mockImplementation((async () => {
    return { rows: q.shift() ?? [] } as never;
  }) as never);
}

beforeEach(() => vi.resetAllMocks());

describe("enrichRefsWithPaperMatchAndEdges", () => {
  it("returns refs unchanged + matchedPaperId NULL + 0 counts when no edges/papers", async () => {
    stubExecute([[], [], []]);
    const refs = [{ id: 1, doi: null }, { id: 2, doi: "10.x/y" }];
    const out = await enrichRefsWithPaperMatchAndEdges(refs, USER_ID);
    expect(out).toEqual([
      { id: 1, doi: null, matchedPaperId: null, citedInCount: 0, citingCount: 0 },
      { id: 2, doi: "10.x/y", matchedPaperId: null, citedInCount: 0, citingCount: 0 },
    ]);
  });

  it("attaches matchedPaperId when ref.doi matches a paper the user owns", async () => {
    stubExecute([
      // doi → paperId map (user-scoped query)
      [{ doi: "10.x/y", paper_id: "paper-uuid-1" }],
      // citedIn counts
      [],
      // citing counts
      [],
    ]);
    const refs = [{ id: 1, doi: "10.x/y" }];
    const out = await enrichRefsWithPaperMatchAndEdges(refs, USER_ID);
    expect(out[0].matchedPaperId).toBe("paper-uuid-1");
  });

  it("attaches citedInCount + citingCount per ref from paper_citations", async () => {
    stubExecute([
      // citedIn: cited_id = '1' has 3 rows; '2' has 1
      [{ cited_id: "1", n: 3 }, { cited_id: "2", n: 1 }],
      // citing: citer_id = '2' has 5 rows
      [{ citer_id: "2", n: 5 }],
    ]);
    const refs = [{ id: 1, doi: null }, { id: 2, doi: null }];
    const out = await enrichRefsWithPaperMatchAndEdges(refs, USER_ID);
    expect(out[0]).toMatchObject({ id: 1, citedInCount: 3, citingCount: 0 });
    expect(out[1]).toMatchObject({ id: 2, citedInCount: 1, citingCount: 5 });
  });

  it("skips the paper DOI lookup when no refs have DOI values", async () => {
    stubExecute([
      // citedIn counts
      [],
      // citing counts
      [],
    ]);
    const refs = [{ id: 1, doi: null }, { id: 2, doi: "" }];
    const out = await enrichRefsWithPaperMatchAndEdges(refs, USER_ID);
    expect(out).toEqual([
      { id: 1, doi: null, matchedPaperId: null, citedInCount: 0, citingCount: 0 },
      { id: 2, doi: "", matchedPaperId: null, citedInCount: 0, citingCount: 0 },
    ]);
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(2);
  });

  it("does NOT match cross-user papers (user_id scoping in SQL)", async () => {
    // SQL should already filter by user_id; helper just trusts the result.
    // Empty doi-map result → no match.
    stubExecute([[], [], []]);
    const refs = [{ id: 1, doi: "10.x/y" }];
    const out = await enrichRefsWithPaperMatchAndEdges(refs, USER_ID);
    expect(out[0].matchedPaperId).toBeNull();
  });
});
