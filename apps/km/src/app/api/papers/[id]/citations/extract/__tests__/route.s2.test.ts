import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@episteme/auth/byok", () => ({
  getDecryptedApiKey: vi.fn().mockResolvedValue("sk-or-test"),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/lib/ai/pdf-text", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/citations/annotation-extractor", () => ({
  extractAnnotationMarkers: vi.fn(),
}));
vi.mock("@/lib/citations/parser", () => ({
  extractCitations: vi.fn(),
}));
vi.mock("@/lib/papers/extract-doi-from-first-page", () => ({
  extractDoiFromFirstPage: vi.fn(),
}));
vi.mock("@/lib/semantic-scholar", () => ({
  fetchPaperReferences: vi.fn(),
}));

import { auth } from "@episteme/auth";
import { db } from "@/lib/db";
import { extractPdfPages } from "@/lib/ai/pdf-text";
import { extractAnnotationMarkers } from "@/lib/citations/annotation-extractor";
import { extractCitations } from "@/lib/citations/parser";
import { fetchPaperReferences } from "@/lib/semantic-scholar";
import { POST } from "../route";

const PAPER_ID = "00000000-0000-0000-0000-000000000099";
const buildReq = () =>
  new Request(`http://x/api/papers/${PAPER_ID}/citations/extract`, {
    method: "POST",
  }) as unknown as import("next/server").NextRequest;
const routeParams = { params: Promise.resolve({ id: PAPER_ID }) };

function stubPaperSelect(row: Record<string, unknown>) {
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({
      where: () => ({ limit: async () => [row] }),
    }),
  } as never);
}

function stubInsertReturning(returnRows: unknown[]) {
  const valuesCalls: unknown[] = [];
  vi.mocked(db.insert).mockReturnValueOnce({
    values: (rows: unknown) => {
      valuesCalls.push(rows);
      return { returning: async () => returnRows };
    },
  } as never);
  return valuesCalls;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.delete).mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  } as never);
  // No-op update by default; tests that care about update will override.
  vi.mocked(db.update).mockReturnValue({
    set: () => ({ where: async () => undefined }),
  } as never);
});

describe("POST /api/papers/[id]/citations/extract — S2 enrichment", () => {
  it("replaces text-parse metadata with S2 metadata when DOI+S2 succeed", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    stubPaperSelect({
      id: PAPER_ID,
      userId: "u1",
      storageUrl: "/tmp/p.pdf",
      doi: "10.1234/source",
    });

    // text-regex returns 3 refs
    vi.mocked(extractAnnotationMarkers).mockResolvedValue({
      references: [],
      markers: [],
    });
    vi.mocked(extractPdfPages).mockResolvedValue([
      { pageNumber: 1, text: "first page" },
    ]);
    vi.mocked(extractCitations).mockReturnValue({
      markers: [
        { markerText: "[1]", markerIndex: 1, pageNumber: 10 },
        { markerText: "[2]", markerIndex: 2, pageNumber: 11 },
        { markerText: "[3]", markerIndex: 3, pageNumber: 12 },
      ],
      references: [
        { markerIndex: 1, rawText: "noisy 1", title: "TP1" },
        { markerIndex: 2, rawText: "noisy 2", title: "TP2" },
        { markerIndex: 3, rawText: "noisy 3", title: "TP3" },
      ],
    });

    // S2 returns 3 refs with proper metadata
    vi.mocked(fetchPaperReferences).mockResolvedValue([
      {
        paperId: "s2-1",
        title: "S2 Title One",
        authors: [{ name: "A One" }],
        year: 2021,
        doi: "10.1/one",
        externalIds: { DOI: "10.1/one" },
        abstract: "abs1",
        venue: "V1",
        citationCount: 5,
        influentialCitationCount: 1,
        openAccessPdfUrl: "https://oa/1.pdf",
        tldrText: "tldr1",
      },
      {
        paperId: "s2-2",
        title: "S2 Title Two",
        authors: [{ name: "A Two" }],
        year: 2022,
        doi: "10.1/two",
        externalIds: { DOI: "10.1/two" },
        abstract: "abs2",
        venue: "V2",
        citationCount: 8,
        influentialCitationCount: 2,
        openAccessPdfUrl: null,
        tldrText: null,
      },
      {
        paperId: "s2-3",
        title: "S2 Title Three",
        authors: [{ name: "A Three" }],
        year: 2023,
        doi: null,
        externalIds: {},
        abstract: null,
        venue: null,
        citationCount: null,
        influentialCitationCount: null,
        openAccessPdfUrl: null,
        tldrText: null,
      },
    ]);

    const valuesCalls = stubInsertReturning([
      { id: 1, markerIndex: 1 },
      { id: 2, markerIndex: 2 },
      { id: 3, markerIndex: 3 },
    ]);

    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.extractionMethod).toBe("text-regex+s2");

    const inserted = valuesCalls[0] as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(3);
    // marker positions from text-parse
    expect(inserted[0].markerIndex).toBe(1);
    expect(inserted[0].pageNumber).toBe(10);
    expect(inserted[1].pageNumber).toBe(11);
    // metadata from S2
    expect(inserted[0].title).toBe("S2 Title One");
    expect(inserted[0].doi).toBe("10.1/one");
    expect(inserted[0].semanticScholarId).toBe("s2-1");
    expect(inserted[0].abstract).toBe("abs1");
    expect(inserted[0].venue).toBe("V1");
    expect(inserted[0].citationCount).toBe(5);
    expect(inserted[1].title).toBe("S2 Title Two");
    expect(inserted[2].title).toBe("S2 Title Three");
  });

  it("falls back to text-parse metadata when S2 returns null", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    stubPaperSelect({
      id: PAPER_ID,
      userId: "u1",
      storageUrl: "/tmp/p.pdf",
      doi: "10.1234/source",
    });

    vi.mocked(extractAnnotationMarkers).mockResolvedValue({
      references: [],
      markers: [],
    });
    vi.mocked(extractPdfPages).mockResolvedValue([
      { pageNumber: 1, text: "first page" },
    ]);
    vi.mocked(extractCitations).mockReturnValue({
      markers: [{ markerText: "[1]", markerIndex: 1, pageNumber: 10 }],
      references: [{ markerIndex: 1, rawText: "noisy", title: "TP1" }],
    });
    vi.mocked(fetchPaperReferences).mockResolvedValue(null);

    const valuesCalls = stubInsertReturning([{ id: 1, markerIndex: 1 }]);

    const res = await POST(buildReq(), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.extractionMethod).toBe("text-regex");

    const inserted = valuesCalls[0] as Array<Record<string, unknown>>;
    expect(inserted[0].title).toBe("TP1");
    expect(inserted[0].semanticScholarId).toBeNull();
  });
});
