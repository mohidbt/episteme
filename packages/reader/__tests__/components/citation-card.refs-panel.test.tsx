import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CitationCard, type CitationWithStatus } from "../../src/components/CitationCard";

// D7.4 — References panel rewrite:
//   - Auto-promote ref → paper card when matchedPaperId is set; click → /papers/[id]/read.
//   - Surface Cited-in / Citing edge counts as badges.

function makeCitation(overrides: Partial<CitationWithStatus> = {}): CitationWithStatus {
  return {
    id: 1,
    paperId: "00000000-0000-0000-0000-000000000001",
    markerText: "[1]",
    markerIndex: 1,
    rawText: null,
    title: "Test Paper Title",
    authors: null,
    year: "2022",
    doi: "10.1234/test",
    url: null,
    semanticScholarId: null,
    abstract: null,
    venue: null,
    citationCount: null,
    pageNumber: null,
    createdAt: new Date(),
    influentialCitationCount: null,
    openAccessPdfUrl: null,
    tldrText: null,
    externalIds: null,
    bibtex: null,
    isOpenAccess: false,
    keptId: null,
    libraryReferenceId: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("CitationCard — D7.4 ref-as-paper auto-promote", () => {
  it("renders title as link to /papers/[id]/read when matchedPaperId is set", () => {
    render(
      <CitationCard
        citation={makeCitation()}
        matchedPaperId="paper-uuid-abc"
        variant="compact"
      />
    );
    const link = screen.getByRole("link", { name: /test paper title/i });
    expect(link.getAttribute("href")).toBe("/papers/paper-uuid-abc/read");
  });

  it("renders title as plain text/external link when matchedPaperId is absent", () => {
    render(
      <CitationCard
        citation={makeCitation()}
        variant="compact"
      />
    );
    // No internal paper link; either no link, or only the external DOI link.
    const reader = screen.queryByRole("link", { name: /test paper title/i });
    expect(reader?.getAttribute("href")).not.toBe("/papers/paper-uuid-abc/read");
  });
});

describe("CitationCard — D7.4 Cited-in / Citing badges", () => {
  it("renders Cited-in count badge when citedInCount > 0", () => {
    render(
      <CitationCard
        citation={makeCitation()}
        citedInCount={3}
        citingCount={0}
        variant="compact"
      />
    );
    expect(screen.getByTestId("ref-cited-in-count").textContent).toContain("3");
  });

  it("renders Citing count badge when citingCount > 0", () => {
    render(
      <CitationCard
        citation={makeCitation()}
        citedInCount={0}
        citingCount={5}
        variant="compact"
      />
    );
    expect(screen.getByTestId("ref-citing-count").textContent).toContain("5");
  });

  it("hides badges when both counts are 0", () => {
    render(
      <CitationCard
        citation={makeCitation()}
        citedInCount={0}
        citingCount={0}
        variant="compact"
      />
    );
    expect(screen.queryByTestId("ref-cited-in-count")).toBeNull();
    expect(screen.queryByTestId("ref-citing-count")).toBeNull();
  });
});
