import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CitationCard, type CitationWithStatus } from "../../src/components/CitationCard";

function makeCitation(abstract: string): CitationWithStatus {
  return {
    id: 1,
    paperId: "00000000-0000-0000-0000-000000000001",
    markerText: "[1]",
    markerIndex: 1,
    rawText: null,
    title: "Test Paper",
    authors: [{ name: "Alice" }],
    year: "2022",
    doi: null,
    url: null,
    semanticScholarId: null,
    abstract,
    venue: null,
    citationCount: null,
    pageNumber: null,
    createdAt: new Date(),
    influentialCitationCount: null,
    tldrText: null,
    openAccessPdfUrl: null,
    externalIds: null,
    referenceCount: null,
    isOpenAccess: null,
    bibtex: null,
    publicationTypes: null,
    publicationDate: null,
    journal: null,
    embedding: null,
    embeddingPaper: null,
    embeddingModel: null,
    enrichSource: null,
    enrichStatus: null,
    enrichedAt: null,
    keptId: null,
    libraryReferenceId: null,
  } as unknown as CitationWithStatus;
}

afterEach(() => cleanup());

describe("CitationCard abstract rendering", () => {
  it("strips JATS tags from the rendered abstract", () => {
    render(<CitationCard citation={makeCitation("<jats:p>foo bar baz</jats:p>")} variant="compact" />);
    const text = screen.getByText(/foo bar baz/);
    expect(text.textContent).not.toMatch(/<jats:/);
    expect(text.textContent).not.toMatch(/<\/jats:/);
    expect(text.textContent).toContain("foo bar baz");
  });

  it("decodes HTML entities in the rendered abstract", () => {
    render(<CitationCard citation={makeCitation("Tom &amp; Jerry &lt;3")} variant="compact" />);
    expect(screen.getByText(/Tom & Jerry <3/)).toBeTruthy();
  });
});
