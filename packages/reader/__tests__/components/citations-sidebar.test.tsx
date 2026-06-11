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
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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

describe("CitationsSidebar — auto-enrich", () => {
  // GSD-74: trigger uses enrichedAt + DOI, not semanticScholarId. Refs without
  // DOI are unenrichable via S2 → must not trigger POST.
  it("POSTs to enrich when any DOI-bearing ref lacks enrichedAt", async () => {
    const citations = [
      makeCitation({ id: 1, doi: "10.1/a", enrichedAt: new Date() }),
      makeCitation({ id: 2, doi: "10.2/b", enrichedAt: null }),
    ];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/papers/${PAPER_ID}/citations/enrich`,
        expect.objectContaining({ method: "POST", credentials: "include" })
      );
    });
  });

  it("does NOT POST when every DOI-bearing ref has enrichedAt set", async () => {
    const citations = [
      makeCitation({ id: 1, doi: "10.1/a", enrichedAt: new Date() }),
      makeCitation({ id: 2, doi: "10.2/b", enrichedAt: new Date() }),
    ];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    // Wait a tick to confirm no fetch fires
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT POST when unenriched refs have no DOI (S2 needs a resolvable id)", async () => {
    const citations = [
      makeCitation({ id: 1, doi: null, enrichedAt: null }),
      makeCitation({ id: 2, doi: "", enrichedAt: null }),
    ];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does NOT POST when citations list is empty", async () => {
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={[]}
        loading={false}
      />
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls onExtracted on successful enrich", async () => {
    const onExtracted = vi.fn();
    const citations = [makeCitation({ doi: "10.1/needs-enrich", enrichedAt: null })];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
        onExtracted={onExtracted}
      />
    );
    await waitFor(() => expect(onExtracted).toHaveBeenCalledTimes(1));
  });

  it("does NOT fire enrich a second time on re-render", async () => {
    const citations = [makeCitation({ doi: "10.1/needs-enrich", enrichedAt: null })];
    const { rerender } = render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    // Re-render with same citations
    rerender(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows enriching indicator while in flight, hides when done", async () => {
    // Use a slow fetch to observe the loading state
    let resolveEnrich!: () => void;
    const slowFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveEnrich = () =>
            resolve({
              ok: true,
              json: async () => ({ enriched: 1, total: 1 }),
            } as Response);
        })
    );
    global.fetch = slowFetch;

    const citations = [makeCitation({ doi: "10.1/needs-enrich", enrichedAt: null })];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );

    await waitFor(() =>
      expect(screen.queryByText(/enriching/i)).not.toBeNull()
    );

    resolveEnrich();

    await waitFor(() =>
      expect(screen.queryByText(/enriching/i)).toBeNull()
    );
  });

  it("does not crash on fetch error; does not show enriching indicator after error; calls toast.error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network fail"));
    const citations = [makeCitation({ doi: "10.1/needs-enrich", enrichedAt: null })];
    render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    await waitFor(() =>
      expect(screen.queryByText(/enriching/i)).toBeNull()
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("fires enrich again when paperId changes", async () => {
    const PAPER_ID_A = "00000000-0000-0000-0000-000000000001";
    const PAPER_ID_B = "00000000-0000-0000-0000-000000000002";
    const citations = [makeCitation({ doi: "10.1/needs-enrich", enrichedAt: null })];
    const { rerender } = render(
      <CitationsSidebar
        paperId={PAPER_ID_A}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    rerender(
      <CitationsSidebar
        paperId={PAPER_ID_B}
        open={true}
        citations={citations}
        loading={false}
      />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      `/api/papers/${PAPER_ID_B}/citations/enrich`,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("does not call onExtracted if panel closes before fetch resolves", async () => {
    let capturedSignal!: AbortSignal;
    let resolveEnrich!: () => void;
    global.fetch = vi.fn(
      (_url: URL | RequestInfo, opts?: RequestInit) => {
        capturedSignal = opts?.signal as AbortSignal;
        return new Promise<Response>((resolve, reject) => {
          resolveEnrich = () => {
            if (capturedSignal?.aborted) {
              reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
            } else {
              resolve({ ok: true, json: async () => ({ enriched: 1, total: 1 }) } as Response);
            }
          };
          capturedSignal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("AbortError"), { name: "AbortError" }))
          );
        });
      }
    );

    const onExtracted = vi.fn();
    const citations = [makeCitation({ doi: "10.1/needs-enrich", enrichedAt: null })];

    const { rerender } = render(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={true}
        citations={citations}
        loading={false}
        onExtracted={onExtracted}
      />
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    // Close the panel — triggers effect cleanup → controller.abort()
    rerender(
      <CitationsSidebar
        paperId={PAPER_ID}
        open={false}
        citations={citations}
        loading={false}
        onExtracted={onExtracted}
      />
    );

    // Wait for abort to propagate then confirm onExtracted not called
    await new Promise((r) => setTimeout(r, 50));
    expect(onExtracted).not.toHaveBeenCalled();
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

  it("shows generic error toast when extract returns non-2xx", async () => {
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
      expect(toast.error).toHaveBeenCalledWith("Extraction failed. Please try again.");
    });
    expect(onExtracted).not.toHaveBeenCalled();
  });

  it("calls onExtracted on successful 200 with no unavailable flag", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ references: [], stats: { extractionMethod: "text-regex" } }),
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
    expect(toast.error).not.toHaveBeenCalled();
  });
});
