// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// CitationCard pulls in heavy reader internals; stub to a simple node so we
// can assert on list rendering without exercising the full card.
vi.mock("@episteme/reader", () => ({
  CitationCard: ({ citation }: { citation: { id: number; title?: string | null } }) => (
    <div data-testid={`citation-card-${citation.id}`}>{citation.title ?? "untitled"}</div>
  ),
}));

import { PaperCitationsList, citationsRefreshEvent } from "./PaperCitationsList";

const mockFetch = vi.fn();
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
    mockFetch.mockResolvedValueOnce(jsonResponse({ citations: [] }));
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
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        citations: [
          { id: 1, title: "First ref", markerIndex: 1 },
          { id: 2, title: "Second ref", markerIndex: 2 },
          { id: 3, title: "Third ref", markerIndex: 3 },
        ],
      }),
    );
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
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ citations: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ citations: [{ id: 42, title: "Late ref", markerIndex: 1 }] }),
      );
    render(<PaperCitationsList paperId="paper-1" />);
    await waitFor(() => expect(screen.getByText(/no citations yet/i)).toBeTruthy());

    await act(async () => {
      window.dispatchEvent(new Event(citationsRefreshEvent("paper-1")));
    });
    await waitFor(() => expect(screen.getByTestId("citation-card-42")).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
