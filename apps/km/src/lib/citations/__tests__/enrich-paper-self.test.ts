import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    update: vi.fn(),
  },
}));

vi.mock("../semantic-scholar", async () => {
  const actual = await vi.importActual<typeof import("../semantic-scholar")>(
    "../semantic-scholar",
  );
  return {
    ...actual,
    resolvePaperId: vi.fn(),
    fetchPaperBatch: vi.fn(),
  };
});

vi.mock("@episteme/auth/byok", () => ({
  getUserS2Key: vi.fn().mockResolvedValue(null),
}));

import { db } from "@/lib/db";
import { resolvePaperId, fetchPaperBatch } from "../semantic-scholar";
import { enrichPaperSelfFromS2 } from "../enrich-paper-self";

const PAPER = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "u-test",
  title: "Bad OCR Title",
  authors: ["First, A."],
  year: 2020,
  doi: "10.1234/foo",
};

function captureUpdate() {
  const captured: { values: Record<string, unknown> | null } = { values: null };
  const chain: Record<string, unknown> = {
    set: (values: Record<string, unknown>) => {
      captured.values = values;
      return chain;
    },
    where: () => Promise.resolve([]),
  };
  vi.mocked(db.update).mockReturnValue(chain as never);
  return captured;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolvePaperId).mockReset();
  vi.mocked(fetchPaperBatch).mockReset();
});

describe("enrichPaperSelfFromS2", () => {
  it("returns { enriched: false } when paper has no DOI (no-op)", async () => {
    const captured = captureUpdate();
    const result = await enrichPaperSelfFromS2({ ...PAPER, doi: null });
    expect(result.enriched).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
    expect(captured.values).toBeNull();
  });

  it("overwrites paper metadata when S2 resolves the DOI", async () => {
    vi.mocked(resolvePaperId).mockResolvedValue("s2-pid");
    vi.mocked(fetchPaperBatch).mockResolvedValue([
      {
        paperId: "s2-pid",
        title: "Attention Is All You Need",
        authors: [{ name: "Vaswani, A." }, { name: "Shazeer, N." }],
        year: 2017,
        externalIds: { DOI: "10.48550/arXiv.1706.03762" },
        abstract: "We propose a new architecture...",
        venue: "NeurIPS",
        citationCount: 100000,
        influentialCitationCount: 5000,
        openAccessPdfUrl: null,
        isOpenAccess: true,
        tldr: null,
        bibtex: null,
      },
    ]);
    const captured = captureUpdate();

    const result = await enrichPaperSelfFromS2(PAPER);

    expect(result.enriched).toBe(true);
    expect(result.s2PaperId).toBe("s2-pid");
    expect(captured.values).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Vaswani, A.", "Shazeer, N."],
      year: 2017,
      doi: "10.48550/arXiv.1706.03762",
      venue: "NeurIPS",
      abstractShort: "We propose a new architecture...",
    });
  });

  it("trims abstract to ~500 chars before persisting", async () => {
    const longAbstract = "x".repeat(2000);
    vi.mocked(resolvePaperId).mockResolvedValue("s2-pid");
    vi.mocked(fetchPaperBatch).mockResolvedValue([
      {
        paperId: "s2-pid",
        title: "T",
        authors: [],
        year: 2017,
        externalIds: null,
        abstract: longAbstract,
        venue: null,
        citationCount: null,
        influentialCitationCount: null,
        openAccessPdfUrl: null,
        isOpenAccess: null,
        tldr: null,
        bibtex: null,
      },
    ]);
    const captured = captureUpdate();

    await enrichPaperSelfFromS2(PAPER);

    const abs = captured.values?.abstractShort as string;
    expect(abs.length).toBeLessThanOrEqual(500);
  });

  it("returns { enriched: false } when S2 can't resolve the DOI", async () => {
    vi.mocked(resolvePaperId).mockResolvedValue(null);
    const captured = captureUpdate();

    const result = await enrichPaperSelfFromS2(PAPER);

    expect(result.enriched).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
    expect(captured.values).toBeNull();
  });

  it("returns { enriched: false } when S2 throws (silent skip — does not propagate)", async () => {
    vi.mocked(resolvePaperId).mockRejectedValue(new Error("network down"));
    const captured = captureUpdate();

    const result = await enrichPaperSelfFromS2(PAPER);

    expect(result.enriched).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
    expect(captured.values).toBeNull();
  });

  it("strips JATS XML tags from S2 abstract before persisting (GSD-80)", async () => {
    vi.mocked(resolvePaperId).mockResolvedValue("s2-pid");
    vi.mocked(fetchPaperBatch).mockResolvedValue([
      {
        paperId: "s2-pid",
        title: "T",
        authors: [],
        year: 2017,
        externalIds: null,
        abstract:
          "<jats:title>Abstract</jats:title> <jats:p>Cooperative interactions in <jats:italic>Escherichia coli</jats:italic> &amp; friends.</jats:p>",
        venue: null,
        citationCount: null,
        influentialCitationCount: null,
        openAccessPdfUrl: null,
        isOpenAccess: null,
        tldr: null,
        bibtex: null,
      },
    ]);
    const captured = captureUpdate();

    await enrichPaperSelfFromS2(PAPER);

    const abs = captured.values?.abstractShort as string;
    expect(abs).toBeDefined();
    expect(abs).not.toMatch(/<jats:/);
    expect(abs).not.toMatch(/<\/jats:/);
    expect(abs).toContain("Escherichia coli");
    expect(abs).toContain("&"); // entity decoded
    expect(abs).not.toContain("&amp;");
  });

  it("does not overwrite paper fields with null S2 values", async () => {
    vi.mocked(resolvePaperId).mockResolvedValue("s2-pid");
    vi.mocked(fetchPaperBatch).mockResolvedValue([
      {
        paperId: "s2-pid",
        title: null,
        authors: [],
        year: null,
        externalIds: null,
        abstract: null,
        venue: null,
        citationCount: null,
        influentialCitationCount: null,
        openAccessPdfUrl: null,
        isOpenAccess: null,
        tldr: null,
        bibtex: null,
      },
    ]);
    const captured = captureUpdate();

    const result = await enrichPaperSelfFromS2(PAPER);

    // S2 returned a hit but every field is null — no DB write at all.
    expect(result.enriched).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
    expect(captured.values).toBeNull();
  });
});
