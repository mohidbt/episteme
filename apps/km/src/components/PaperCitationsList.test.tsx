// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// CitationCard pulls in heavy reader internals; stub to a simple node so we
// can assert on list rendering without exercising the full card.
vi.mock("@episteme/reader/citation-card", () => ({
  CitationCard: ({ citation }: { citation: { id: number; title?: string | null } }) => (
    <div data-testid={`citation-card-${citation.id}`}>{citation.title ?? "untitled"}</div>
  ),
}));

import { PaperCitationsList, citationsRefreshEvent } from "./PaperCitationsList";

const mockFetch = vi.fn();
function citationsFetch(citations: unknown[]) {
  // Route fetches by URL so the folders side-call doesn't burn a queued response.
  const queue: Response[] = citations.map((c) => jsonResponse({ citations: c }));
  mockFetch.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/folders")) {
      return jsonResponse({ folders: [] });
    }
    return queue.shift() ?? jsonResponse({ citations: [] });
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PaperCitationsList", () => {
  it("shows empty-state message when API returns no citations", async () => {
    citationsFetch([[]]);
    render(<PaperCitationsList paperId="paper-1" />);
    await waitFor(() =>
      expect(screen.getByText(/no citations yet/i)).toBeTruthy(),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/papers/paper-1/citations",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("renders one CitationCard per ref returned by /citations", async () => {
    citationsFetch([
      [
        { id: 1, title: "First ref", markerIndex: 1 },
        { id: 2, title: "Second ref", markerIndex: 2 },
        { id: 3, title: "Third ref", markerIndex: 3 },
      ],
    ]);
    render(<PaperCitationsList paperId="paper-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("paper-citations-list")).toBeTruthy();
    });
    expect(screen.getByTestId("citation-card-1")).toBeTruthy();
    expect(screen.getByTestId("citation-card-2")).toBeTruthy();
    expect(screen.getByTestId("citation-card-3")).toBeTruthy();
    expect(screen.getByText(/Citations · 3/)).toBeTruthy();
  });

  it("reloads when the refresh event fires for the same paperId", async () => {
    citationsFetch([[], [{ id: 42, title: "Late ref", markerIndex: 1 }]]);
    render(<PaperCitationsList paperId="paper-1" />);
    await waitFor(() => expect(screen.getByText(/no citations yet/i)).toBeTruthy());

    await act(async () => {
      window.dispatchEvent(new Event(citationsRefreshEvent("paper-1")));
    });
    await waitFor(() => expect(screen.getByTestId("citation-card-42")).toBeTruthy());
    // Two citations fetches + one folders fetch from initial mount
    const citationsCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === "string" && url.startsWith("/api/papers/"),
    );
    expect(citationsCalls.length).toBe(2);
  });

  it("polls until all refs are enriched, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // 1: initial mount — 2 unenriched refs (no semanticScholarId, no abstract, no venue)
      // 2: refresh event triggers reload — still both unenriched → poll begins
      // 3: poll tick 1 — one enriched, one unenriched → keep polling
      // 4: poll tick 2 — both enriched → stop polling
      const unenriched = (id: number) => ({
        id,
        title: `ref ${id}`,
        markerIndex: id,
        semanticScholarId: null,
        abstract: null,
        venue: null,
      });
      const enriched = (id: number) => ({
        id,
        title: `ref ${id}`,
        markerIndex: id,
        semanticScholarId: "s2-" + id,
        abstract: "an abstract",
        venue: "Nature",
      });
      citationsFetch([
        [unenriched(1), unenriched(2)],
        [unenriched(1), unenriched(2)],
        [enriched(1), unenriched(2)],
        [enriched(1), enriched(2)],
      ]);

      render(<PaperCitationsList paperId="paper-1" />);
      await waitFor(() => expect(screen.getByTestId("citation-card-1")).toBeTruthy());

      await act(async () => {
        window.dispatchEvent(new Event(citationsRefreshEvent("paper-1")));
      });
      // After refresh event sees unenriched refs, header should show "Enriching…"
      await waitFor(() => expect(screen.getByText(/Enriching/i)).toBeTruthy());

      // Advance to first poll tick (8s initial delay)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      // Still polling — one still unenriched
      expect(screen.queryByText(/Enriching/i)).toBeTruthy();

      // Advance to next tick (6s interval)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000);
      });
      // All enriched — polling should stop
      await waitFor(() => expect(screen.queryByText(/Enriching/i)).toBeFalsy());

      const before = mockFetch.mock.calls.filter(
        ([url]) => typeof url === "string" && url.startsWith("/api/papers/"),
      ).length;
      // Wait an extra cycle to make sure no further fetches fire
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
      const after = mockFetch.mock.calls.filter(
        ([url]) => typeof url === "string" && url.startsWith("/api/papers/"),
      ).length;
      expect(after).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling after max attempts even if refs remain unenriched", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const unenriched = (id: number) => ({
        id,
        title: `ref ${id}`,
        markerIndex: id,
        semanticScholarId: null,
        abstract: null,
        venue: null,
      });
      // Always return unenriched — never resolves
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.startsWith("/api/folders")) {
          return jsonResponse({ folders: [] });
        }
        return jsonResponse({ citations: [unenriched(1)] });
      });

      render(<PaperCitationsList paperId="paper-1" />);
      await waitFor(() => expect(screen.getByTestId("citation-card-1")).toBeTruthy());

      await act(async () => {
        window.dispatchEvent(new Event(citationsRefreshEvent("paper-1")));
      });
      await waitFor(() => expect(screen.getByText(/Enriching/i)).toBeTruthy());

      // Run far past max polling window (~3 min worth)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });

      // Polling must have stopped
      expect(screen.queryByText(/Enriching/i)).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up polling on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const unenriched = (id: number) => ({
        id,
        title: `ref ${id}`,
        markerIndex: id,
        semanticScholarId: null,
        abstract: null,
        venue: null,
      });
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.startsWith("/api/folders")) {
          return jsonResponse({ folders: [] });
        }
        return jsonResponse({ citations: [unenriched(1)] });
      });

      const { unmount } = render(<PaperCitationsList paperId="paper-1" />);
      await waitFor(() => expect(screen.getByTestId("citation-card-1")).toBeTruthy());
      await act(async () => {
        window.dispatchEvent(new Event(citationsRefreshEvent("paper-1")));
      });
      await waitFor(() => expect(screen.getByText(/Enriching/i)).toBeTruthy());

      unmount();
      const before = mockFetch.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      // No new fetches after unmount
      expect(mockFetch.mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
