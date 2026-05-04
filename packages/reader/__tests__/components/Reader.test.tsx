import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent, screen } from "@testing-library/react";

// Stub PdfViewer — react-pdf needs a real PDF + workers, neither of which a
// JSDOM smoke test can supply. The point here is to assert the composer's
// root attrs render, not to exercise PDF.js.
vi.mock("../../src/components/PdfViewer", () => ({
  PdfViewer: ({ userHighlights }: { userHighlights?: Array<{ rects?: unknown[] }> }) => {
    return (
      <div data-testid="pdf-viewer-stub">
        <div
          data-highlight-rect-count={
            (userHighlights ?? []).reduce((sum, h) => sum + (Array.isArray(h.rects) ? h.rects.length : 0), 0)
          }
        />
        <div data-page-number="1">
          <div className="react-pdf__Page__textContent">
            <span>alpha beta gamma</span>
          </div>
        </div>
        <div data-page-number="2">
          <div className="react-pdf__Page__textContent">
            <span>beta gamma delta</span>
          </div>
        </div>
        <div data-page-number="3">
          <div className="react-pdf__Page__textContent">
            <span>gamma delta epsilon</span>
          </div>
        </div>
      </div>
    );
  },
}));

import { Reader } from "../../src/components/Reader";
import { useReaderState } from "../../src/hooks/use-reader-state";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  useReaderState.setState({ currentPage: 1, totalPages: 3, scrollTargetPage: null, zoom: 1.0, toolbarCollapsed: false });
  // happy-dom doesn't ship a localStorage impl; sidebar dock hooks call it.
  if (!("localStorage" in window) || typeof window.localStorage?.getItem !== "function") {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith(`/api/papers/${PAPER_ID}`)) {
        return new Response(
          JSON.stringify({ title: "Test paper", processingStatus: "ready" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes(`/api/papers/${PAPER_ID}/citations/markers`)) {
        return new Response(JSON.stringify({ markers: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/api/papers/${PAPER_ID}/citations`)) {
        return new Response(JSON.stringify({ citations: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/api/user-highlights?paperId=${PAPER_ID}`)) {
        return new Response(JSON.stringify({ highlights: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/api/paper-highlights?paperId=${PAPER_ID}`)) {
        return new Response(JSON.stringify([
          {
            id: "a1",
            page: 1,
            bbox: [
              { page: 1, x0: 10, y0: 100, x1: 20, y1: 110 },
              { page: 1, x0: 25, y0: 100, x1: 35, y1: 110 },
              { page: 1, x0: 40, y0: 100, x1: 50, y1: 110 },
            ],
            color: "amber",
            noteMd: null,
            runId: "run-1",
            toolCallId: "tool-1",
            createdAt: new Date().toISOString(),
          },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/api/papers/${PAPER_ID}/auto-highlight/runs`)) {
        return new Response(JSON.stringify({ runs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Reader", () => {
  it("renders root with data-reader-root and data-reader-mode", async () => {
    const { container } = render(<Reader paperId={PAPER_ID} />);
    const root = container.querySelector("[data-reader-root]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-reader-mode")).toBe("full");
    // Wait for paper meta fetch to settle so we don't leak pending promises.
    await waitFor(() =>
      expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    );
  });

  it("honors mode prop", () => {
    const { container } = render(<Reader paperId={PAPER_ID} mode="lite" />);
    const root = container.querySelector("[data-reader-root]");
    expect(root?.getAttribute("data-reader-mode")).toBe("lite");
  });

  it("agent tool call with 3 highlight rects renders 3 visual highlights in PDF layer", async () => {
    const { getByTestId } = render(<Reader paperId={PAPER_ID} />);
    await waitFor(() => {
      expect(getByTestId("pdf-viewer-stub").querySelector("[data-highlight-rect-count]")?.getAttribute("data-highlight-rect-count")).toBe("3");
    });
  });

  it("after closing FindBar, page nav action changes page", async () => {
    render(<Reader paperId={PAPER_ID} />);

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const findInput = await screen.findByPlaceholderText("Find in document…");
    fireEvent.change(findInput, { target: { value: "beta" } });
    fireEvent.keyDown(findInput, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Find in document…")).toBeNull();
    });

    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByText("2 / 3")).toBeTruthy();
    });
  });
});
