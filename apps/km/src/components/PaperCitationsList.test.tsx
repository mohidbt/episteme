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
});
