import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { CitationsSidebar } from "../../src/components/CitationsSidebar";
import type { CitationWithStatus } from "../../src/components/CitationCard";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock CitationCard to make assertions easy
vi.mock("../../src/components/CitationCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/components/CitationCard")>();
  return {
    ...actual,
    CitationCard: ({
      citation,
      variant,
      onSaveToLibrary,
    }: {
      citation: CitationWithStatus;
      variant?: string;
      onSaveToLibrary?: (folderId: string | null) => void;
    }) => (
      <div data-testid="citation-card" data-variant={variant} data-citation-id={citation.id}>
        {onSaveToLibrary && (
          <button type="button" data-testid={`save-${citation.id}`} onClick={() => onSaveToLibrary(null)}>
            Save to Library
          </button>
        )}
      </div>
    ),
  };
});

// Mock sonner toast
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCitation(overrides: Partial<CitationWithStatus> = {}): CitationWithStatus {
  return {
    id: 1,
    paperId: "00000000-0000-0000-0000-000000000001",
    markerText: "[1]",
    markerIndex: 1,
    rawText: null,
    title: "Test Paper",
    authors: null,
    year: null,
    doi: null,
    url: null,
    semanticScholarId: "s2id-123",
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
    isOpenAccess: null,
    enrichedAt: new Date(),
    keptId: null,
    libraryReferenceId: null,
    ...overrides,
  };
}

const PAPER_ID = "00000000-0000-0000-0000-000000000042";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ enriched: 1, total: 1 }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CitationsSidebar — compact CitationCard rendering", () => {
  it("renders CitationCard with variant=compact for each citation", () => {
    const citations = [
      makeCitation({ id: 1 }),
      makeCitation({ id: 2, markerIndex: 2 }),
    ];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    const cards = screen.getAllByTestId("citation-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.getAttribute("data-variant")).toBe("compact");
    }
  });

  it("does not render citation cards when loading", () => {
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[makeCitation()]}
        loading={true}
      />
    );
    expect(screen.queryAllByTestId("citation-card")).toHaveLength(0);
  });

  it("passes save-to-library callback to compact cards", async () => {
    const onSaveToLibrary = vi.fn();
    const citations = [makeCitation({ id: 11 })];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
        onSaveToLibrary={onSaveToLibrary}
      />
    );

    const btn = screen.getByTestId("save-11");
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSaveToLibrary).toHaveBeenCalledWith(11, null);
  });
});

describe("CitationsSidebar — enriching banner (GSD-74 r4)", () => {
  // Enrichment POST + polling moved to `useCitationEnrichment` (parent-owned).
  // The sidebar is now a pure view of the `enriching` flag.
  it("shows enriching banner when `enriching` prop is true", () => {
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[makeCitation()]}
        loading={false}
        enriching={true}
      />,
    );
    expect(screen.queryByText(/enriching/i)).not.toBeNull();
  });

  it("hides enriching banner when `enriching` prop is false", () => {
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[makeCitation()]}
        loading={false}
        enriching={false}
      />,
    );
    expect(screen.queryByText(/enriching/i)).toBeNull();
  });

  it("does NOT POST to /enrich on mount (parent owns enrichment now)", async () => {
    const citations = [makeCitation({ doi: "10.1/a", enrichedAt: null })];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    const enrichCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).endsWith("/citations/enrich"),
    );
    expect(enrichCalls).toHaveLength(0);
  });
});

describe("CitationsSidebar — extract button", () => {
  it("shows unavailable toast and does not call onExtracted when extract returns 200 + unavailable:true", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ references: [], unavailable: true }),
    });
    const onExtracted = vi.fn();

    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[]}
        loading={false}
        onExtracted={onExtracted}
      />
    );

    const btn = screen.getByRole("button", { name: /extract citations/i });
    await act(async () => {
      btn.click();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Citation extraction service is unavailable. Please try again later.",
      );
    });
    expect(onExtracted).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/papers/${PAPER_ID}/citations/extract`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("GSD-124: surfaces HTTP status in error description on non-2xx (parity with /p)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const onExtracted = vi.fn();

    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[]}
        loading={false}
        onExtracted={onExtracted}
      />
    );

    const btn = screen.getByRole("button", { name: /extract citations/i });
    await act(async () => {
      btn.click();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Citation extraction failed",
        { description: "HTTP 500" },
      );
    });
    expect(onExtracted).not.toHaveBeenCalled();
  });

  it("GSD-124: success toast surfaces inserted reference count (parity with /p)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        references: [],
        stats: { referencesInserted: 3, extractionMethod: "text-regex" },
      }),
    });
    const onExtracted = vi.fn();

    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[]}
        loading={false}
        onExtracted={onExtracted}
      />
    );

    const btn = screen.getByRole("button", { name: /extract citations/i });
    await act(async () => {
      btn.click();
    });

    await waitFor(() => expect(onExtracted).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Found 3 citations");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("GSD-124: success toast says 'No citations detected' when none inserted", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        references: [],
        stats: { referencesInserted: 0, extractionMethod: "text-regex" },
      }),
    });
    const onExtracted = vi.fn();

    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[]}
        loading={false}
        onExtracted={onExtracted}
      />
    );

    const btn = screen.getByRole("button", { name: /extract citations/i });
    await act(async () => {
      btn.click();
    });

    await waitFor(() => expect(onExtracted).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("No citations detected");
  });

  it("GSD-124: singular 'citation' when exactly 1 inserted", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        references: [],
        stats: { referencesInserted: 1, extractionMethod: "text-regex" },
      }),
    });

    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[]}
        loading={false}
        onExtracted={vi.fn()}
      />
    );

    const btn = screen.getByRole("button", { name: /extract citations/i });
    await act(async () => {
      btn.click();
    });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Found 1 citation"),
    );
  });
});
