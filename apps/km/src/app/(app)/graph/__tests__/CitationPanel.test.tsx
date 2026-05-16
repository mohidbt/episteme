// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import CitationPanel from "../CitationPanel";

const PAPER_ID = "paper-1";

type EdgeRow = {
  id: number;
  otherKind: "paper" | "reference";
  otherId: string;
  title: string | null;
  markerIdx: number | null;
};

function mockFetch(handler: (url: string) => EdgeRow[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const edges = handler(url);
      return new Response(JSON.stringify({ edges }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  push.mockReset();
});

describe("CitationPanel", () => {
  it("renders 3 citing edges on initial load", async () => {
    mockFetch(() => [
      { id: 1, otherKind: "paper", otherId: "p2", title: "Alpha", markerIdx: 1 },
      { id: 2, otherKind: "reference", otherId: "10", title: "Beta Ref", markerIdx: 2 },
      { id: 3, otherKind: "paper", otherId: "p3", title: "Gamma", markerIdx: 3 },
    ]);

    render(<CitationPanel paperId={PAPER_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeTruthy();
    });
    expect(screen.getByText("Beta Ref")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });

  it("switching to Cited in tab refetches with direction=cited-in", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push(url);
        const direction = url.includes("cited-in") ? "cited-in" : "citing";
        const edges: EdgeRow[] =
          direction === "cited-in"
            ? [
                {
                  id: 99,
                  otherKind: "paper",
                  otherId: "p9",
                  title: "Citing Paper",
                  markerIdx: null,
                },
              ]
            : [];
        return new Response(JSON.stringify({ edges }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    render(<CitationPanel paperId={PAPER_ID} />);

    await waitFor(() => {
      expect(calls.some((u) => u.includes("direction=citing"))).toBe(true);
    });

    const citedInTab = screen.getByRole("tab", { name: /cited in/i });
    fireEvent.click(citedInTab);

    await waitFor(() => {
      expect(calls.some((u) => u.includes("direction=cited-in"))).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByText("Citing Paper")).toBeTruthy();
    });
  });

  it("clicking a paper-kind row navigates to /graph/{otherId}", async () => {
    mockFetch(() => [
      { id: 1, otherKind: "paper", otherId: "p-other", title: "Target", markerIdx: 1 },
    ]);

    render(<CitationPanel paperId={PAPER_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Target")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Target"));

    expect(push).toHaveBeenCalledWith("/graph/p-other");
  });

  it("does not navigate when reference-kind row is clicked", async () => {
    mockFetch(() => [
      { id: 1, otherKind: "reference", otherId: "10", title: "Ref Entry", markerIdx: 1 },
    ]);

    render(<CitationPanel paperId={PAPER_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Ref Entry")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Ref Entry"));
    expect(push).not.toHaveBeenCalled();
  });
});
