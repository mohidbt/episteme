import { describe, it, expect } from "vitest";
import { buildLibraryReference } from "../library-sync";
import type { DocumentReference } from "@/components/reader/citation-card";

function makeRef(overrides: Partial<DocumentReference> = {}): DocumentReference {
  return {
    id: 1,
    documentId: 10,
    markerText: "[1]",
    markerIndex: 1,
    rawText: null,
    title: null,
    authors: null,
    year: null,
    doi: null,
    url: null,
    semanticScholarId: null,
    abstract: null,
    venue: null,
    citationCount: null,
    pageNumber: null,
    createdAt: new Date("2024-01-01"),
    // Phase 2.2 enrichment fields
    influentialCitationCount: null,
    openAccessPdfUrl: null,
    tldrText: null,
    externalIds: null,
    bibtex: null,
    ...overrides,
  };
}

describe("buildLibraryReference", () => {
  it("uses title when present", () => {
    const ref = makeRef({ title: "My Title", rawText: "raw", markerText: "[1]" });
    const result = buildLibraryReference("user-1", ref);
    expect(result.title).toBe("My Title");
  });

  it("falls back to rawText when title is null", () => {
    const ref = makeRef({ title: null, rawText: "Raw text fallback", markerText: "[1]" });
    const result = buildLibraryReference("user-1", ref);
    expect(result.title).toBe("Raw text fallback");
  });

  it("falls back to markerText when title and rawText are null", () => {
    const ref = makeRef({ title: null, rawText: null, markerText: "[42]" });
    const result = buildLibraryReference("user-1", ref);
    expect(result.title).toBe("[42]");
  });

  it("treats empty-string title as absent and falls back to rawText", () => {
    const ref = makeRef({ title: "", rawText: "Raw text fallback", markerText: "[1]" });
    const result = buildLibraryReference("user-1", ref);
    expect(result.title).toBe("Raw text fallback");
  });

  it("treats whitespace-only rawText as absent and falls back to markerText", () => {
    const ref = makeRef({ title: null, rawText: "   ", markerText: "[7]" });
    const result = buildLibraryReference("user-1", ref);
    expect(result.title).toBe("[7]");
  });

  it("passes through all other fields", () => {
    const ref = makeRef({
      title: "A Paper",
      authors: [{ name: "Smith, J." }],
      year: "2023",
      doi: "10.1234/abc",
      url: "https://example.com",
      semanticScholarId: "abc123",
      abstract: "Some abstract text",
      venue: "Nature",
      citationCount: 42,
    });
    const result = buildLibraryReference("user-99", ref);
    expect(result.userId).toBe("user-99");
    expect(result.authors).toEqual([{ name: "Smith, J." }]);
    expect(result.year).toBe("2023");
    expect(result.doi).toBe("10.1234/abc");
    expect(result.url).toBe("https://example.com");
    expect(result.semanticScholarId).toBe("abc123");
    expect(result.abstract).toBe("Some abstract text");
    expect(result.venue).toBe("Nature");
    expect(result.citationCount).toBe(42);
  });

  it("returns null for absent optional fields", () => {
    const ref = makeRef();
    const result = buildLibraryReference("user-1", ref);
    expect(result.authors).toBeNull();
    expect(result.year).toBeNull();
    expect(result.doi).toBeNull();
    expect(result.url).toBeNull();
    expect(result.semanticScholarId).toBeNull();
    expect(result.abstract).toBeNull();
    expect(result.venue).toBeNull();
    expect(result.citationCount).toBeNull();
  });
});
