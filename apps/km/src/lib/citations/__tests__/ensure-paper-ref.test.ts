import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import { ensurePaperRef, buildCslJsonForPaper } from "../ensure-paper-ref";

type PaperLike = {
  id: string;
  libraryId: number;
  userId: string;
  title: string | null;
  authors: string[] | null;
  year: number | null;
  doi: string | null;
};

const PAPER: PaperLike = {
  id: "11111111-1111-1111-1111-111111111111",
  libraryId: 7,
  userId: "u-test",
  title: "Attention Is All You Need",
  authors: ["Vaswani, A.", "Shazeer, N."],
  year: 2017,
  doi: "10.5/test",
};

function stubSelectQueue(returnQueues: unknown[][]) {
  const queue = [...returnQueues];
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("buildCslJsonForPaper", () => {
  it("seeds CSL with title/authors/year/DOI when present", () => {
    const csl = buildCslJsonForPaper(PAPER);
    expect(csl.title).toBe("Attention Is All You Need");
    expect(csl.author).toEqual([
      { literal: "Vaswani, A." },
      { literal: "Shazeer, N." },
    ]);
    expect(csl.issued).toEqual({ "date-parts": [[2017]] });
    expect(csl.DOI).toBe("10.5/test");
    expect(csl.type).toBe("article-journal");
  });

  it("omits author when none, omits year when null, omits DOI when null", () => {
    const csl = buildCslJsonForPaper({
      ...PAPER,
      authors: null,
      year: null,
      doi: null,
    });
    expect(csl.author).toBeUndefined();
    expect(csl.issued).toBeUndefined();
    expect(csl.DOI).toBeUndefined();
    // title still present
    expect(csl.title).toBe(PAPER.title);
  });

  it("falls back title placeholder when paper title is null", () => {
    const csl = buildCslJsonForPaper({ ...PAPER, title: null });
    expect(typeof csl.title).toBe("string");
    expect(csl.title!.length).toBeGreaterThan(0);
  });
});

describe("ensurePaperRef", () => {
  it("inserts a new ref when none exists for paperId or DOI", async () => {
    // First select: paperId hit lookup (empty). Second: DOI hit lookup (empty).
    stubSelectQueue([[], []]);
    const inserted = { id: "ref-new" };
    const insertChain: Record<string, unknown> = {
      values: () => insertChain,
      returning: () => Promise.resolve([inserted]),
    };
    vi.mocked(db.insert).mockReturnValue(insertChain as never);

    const result = await ensurePaperRef(PAPER);

    expect(result).toEqual({ created: true, refId: "ref-new" });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — skips insert when a ref already points at paperId", async () => {
    stubSelectQueue([[{ id: "ref-existing", paperId: PAPER.id }]]);
    const result = await ensurePaperRef(PAPER);
    expect(result).toEqual({ created: false, refId: "ref-existing" });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("DOI-skip: when ref with matching DOI exists with null paperId, sets paperId and skips insert", async () => {
    // First select: no paperId hit. Second select: DOI hit with null paperId.
    stubSelectQueue([[], [{ id: "ref-doi", paperId: null }]]);
    const updateChain: Record<string, unknown> = {
      set: () => updateChain,
      where: () => Promise.resolve([]),
    };
    vi.mocked(db.update).mockReturnValue(updateChain as never);

    const result = await ensurePaperRef(PAPER);

    expect(result).toEqual({ created: false, refId: "ref-doi" });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("no DOI: only paperId-hit dedup runs", async () => {
    stubSelectQueue([[]]);
    const inserted = { id: "ref-no-doi" };
    const insertChain: Record<string, unknown> = {
      values: () => insertChain,
      returning: () => Promise.resolve([inserted]),
    };
    vi.mocked(db.insert).mockReturnValue(insertChain as never);

    const result = await ensurePaperRef({ ...PAPER, doi: null });
    expect(result).toEqual({ created: true, refId: "ref-no-doi" });
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
