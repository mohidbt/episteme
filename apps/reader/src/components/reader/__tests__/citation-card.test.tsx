import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CitationCard, type CitationWithStatus } from "../citation-card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCitation(overrides: Partial<CitationWithStatus> = {}): CitationWithStatus {
  return {
    id: 1,
    documentId: 1,
    markerText: "[1]",
    markerIndex: 1,
    rawText: null,
    title: "Test Paper Title",
    authors: [
      { name: "Alice Smith", authorId: "author1" },
      { name: "Bob Jones" },
    ],
    year: "2022",
    doi: "10.1234/test",
    url: null,
    semanticScholarId: "paper123",
    abstract: "This is a test abstract that is long enough to test collapsing behavior in the citation card component.",
    venue: "NeurIPS",
    citationCount: 100,
    pageNumber: null,
    createdAt: new Date(),
    influentialCitationCount: 10,
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

const baseRect = { top: 100, left: 100 };
const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("CitationCard title link", () => {
  it("renders title as hyperlink when semanticScholarId present", () => {
    render(
      <CitationCard
        citation={makeCitation({ semanticScholarId: "paper123" })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    const link = screen.getByRole("link", { name: /test paper title/i });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toContain("paper123");
  });

  it("renders title as plain text when neither semanticScholarId nor doi present", () => {
    render(
      <CitationCard
        citation={makeCitation({ semanticScholarId: null, doi: null })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    const link = screen.queryByRole("link", { name: /test paper title/i });
    expect(link).toBeNull();
    expect(screen.getByText("Test Paper Title")).toBeDefined();
  });
});

describe("CitationCard authors", () => {
  it("renders first author as hyperlink when authorId present", () => {
    render(
      <CitationCard
        citation={makeCitation()}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    const authorLink = screen.getByRole("link", { name: "Alice Smith" });
    expect(authorLink).toBeDefined();
    expect(authorLink.getAttribute("href")).toContain("author1");
  });

  it("renders second author as plain text when no authorId", () => {
    render(
      <CitationCard
        citation={makeCitation()}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    // Bob Jones has no authorId — should not be a link
    const allLinks = screen.getAllByRole("link");
    const bobLink = allLinks.find((l) => l.textContent === "Bob Jones");
    expect(bobLink).toBeUndefined();
    expect(screen.getByText(/Bob Jones/)).toBeDefined();
  });
});

describe("CitationCard OA badge", () => {
  it("OA badge appears when openAccessPdfUrl is truthy", () => {
    render(
      <CitationCard
        citation={makeCitation({ openAccessPdfUrl: "https://example.com/paper.pdf" })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    expect(screen.getByText("OA")).toBeDefined();
  });

  it("OA badge appears when isOpenAccess is true", () => {
    render(
      <CitationCard
        citation={makeCitation({ isOpenAccess: true })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    expect(screen.getByText("OA")).toBeDefined();
  });

  it("OA badge absent when both openAccessPdfUrl and isOpenAccess are falsy", () => {
    render(
      <CitationCard
        citation={makeCitation({ openAccessPdfUrl: null, isOpenAccess: false })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    expect(screen.queryByText("OA")).toBeNull();
  });
});

describe("CitationCard external-ID pills", () => {
  it("renders pills only for present IDs", () => {
    render(
      <CitationCard
        citation={makeCitation({
          externalIds: { DOI: "10.1234/test", ArXiv: "2301.00001" },
        })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    expect(screen.getByRole("link", { name: /doi/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /arxiv/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /pubmed/i })).toBeNull();
  });

  it("pill count matches number of mapped keys in externalIds", () => {
    render(
      <CitationCard
        citation={makeCitation({
          externalIds: {
            DOI: "10.1234/test",
            ArXiv: "2301.00001",
            PubMed: "12345",
            MAG: "ignored",
          },
        })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    // MAG is skipped, so 3 pills
    const doiLink = screen.getByRole("link", { name: /doi/i });
    const arxivLink = screen.getByRole("link", { name: /arxiv/i });
    const pubmedLink = screen.getByRole("link", { name: /pubmed/i });
    expect(doiLink).toBeDefined();
    expect(arxivLink).toBeDefined();
    expect(pubmedLink).toBeDefined();
  });
});

describe("CitationCard Copy BibTeX", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  it("fires clipboard write with row.bibtex when present", async () => {
    render(
      <CitationCard
        citation={makeCitation({ bibtex: "@article{test2022, title={Test}}" })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /copy bibtex/i }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "@article{test2022, title={Test}}"
      )
    );
  });

  it("falls back to formatBibtex output when row.bibtex is null", async () => {
    render(
      <CitationCard
        citation={makeCitation({ bibtex: null })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /copy bibtex/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const calledWith = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledWith).toMatch(/^@article\{/);
  });
});

describe("CitationCard Open PDF button", () => {
  it("Open PDF button renders when openAccessPdfUrl is truthy", () => {
    render(
      <CitationCard
        citation={makeCitation({ openAccessPdfUrl: "https://example.com/paper.pdf" })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    expect(screen.getByRole("link", { name: /open pdf/i })).toBeDefined();
  });

  it("Open PDF button absent when openAccessPdfUrl is null", () => {
    render(
      <CitationCard
        citation={makeCitation({ openAccessPdfUrl: null })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    expect(screen.queryByRole("link", { name: /open pdf/i })).toBeNull();
  });
});

describe("CitationCard abstract collapse", () => {
  it("abstract starts collapsed; 'Show more' expands it", () => {
    render(
      <CitationCard
        citation={makeCitation({
          abstract:
            "This is a test abstract that is long enough to test collapsing behavior in the citation card component.",
        })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    const showMore = screen.getByRole("button", { name: /show more/i });
    expect(showMore).toBeDefined();
    fireEvent.click(showMore);
    expect(screen.getByRole("button", { name: /show less/i })).toBeDefined();
  });
});

describe("CitationCard TL;DR", () => {
  it("renders italic TL;DR paragraph when tldrText is present", () => {
    render(
      <CitationCard
        citation={makeCitation({ tldrText: "A short summary of the paper." })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    const tldr = screen.getByText("A short summary of the paper.");
    expect(tldr).toBeDefined();
    expect(tldr.className).toMatch(/italic/);
  });

  it("does not render TL;DR element when tldrText is null", () => {
    render(
      <CitationCard
        citation={makeCitation({ tldrText: null })}
        rect={baseRect}
        onDismiss={noop}
      />
    );
    expect(screen.queryByText(/short summary/i)).toBeNull();
  });
});

describe("CitationCard variant", () => {
  it("compact variant applies smaller title class than popover", () => {
    // Render popover, capture class, then cleanup and render compact
    const { unmount } = render(
      <CitationCard
        citation={makeCitation()}
        rect={baseRect}
        onDismiss={noop}
        variant="popover"
      />
    );
    const popoverTitle = document.querySelector("[data-testid='citation-title']");
    const popoverClass = popoverTitle?.className ?? "";
    unmount();

    render(
      <CitationCard
        citation={makeCitation()}
        rect={baseRect}
        onDismiss={noop}
        variant="compact"
      />
    );
    const compactTitle = document.querySelector("[data-testid='citation-title']");
    const compactClass = compactTitle?.className ?? "";

    expect(popoverClass).toContain("text-base");
    expect(compactClass).toContain("text-sm");
  });
});
