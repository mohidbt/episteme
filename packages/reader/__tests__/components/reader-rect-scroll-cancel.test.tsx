import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";

// Stub PdfViewer (same as reader-rect-scroll.test.tsx).
vi.mock("../../src/components/PdfViewer", () => ({
  PdfViewer: () => <div data-testid="pdf-viewer-stub" />,
}));

import { Reader } from "../../src/components/Reader";
import { useReaderState } from "../../src/hooks/use-reader-state";

const PAPER_ID = "00000000-0000-0000-0000-000000000222";

let scrollIntoViewSpy: ReturnType<typeof vi.fn>;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
let rafQueue: FrameRequestCallback[];
let originalRaf: typeof window.requestAnimationFrame;

beforeEach(() => {
  useReaderState.setState({
    currentPage: 1,
    totalPages: 7,
    scrollTargetPage: null,
    zoom: 1.0,
    toolbarCollapsed: false,
  });

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

  originalScrollIntoView = Element.prototype.scrollIntoView;
  scrollIntoViewSpy = vi.fn();
  Element.prototype.scrollIntoView =
    scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;

  // Manual rAF control so we can interleave clicks before frames fire.
  rafQueue = [];
  originalRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof window.requestAnimationFrame;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith(`/api/papers/${PAPER_ID}`)) {
        return new Response(
          JSON.stringify({ title: "Multi", processingStatus: "ready" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes(`/api/papers/${PAPER_ID}/citations/markers`)) {
        return new Response(JSON.stringify({ markers: [] }), { status: 200 });
      }
      if (url.includes(`/api/papers/${PAPER_ID}/citations`)) {
        return new Response(JSON.stringify({ citations: [] }), { status: 200 });
      }
      if (url.includes(`/api/user-highlights?paperId=${PAPER_ID}`)) {
        return new Response(JSON.stringify({ highlights: [] }), { status: 200 });
      }
      if (url.includes(`/api/paper-highlights?paperId=${PAPER_ID}`)) {
        return new Response(
          JSON.stringify([
            {
              id: "ai-A",
              page: 3,
              bbox: [{ page: 3, x0: 10, y0: 100, x1: 20, y1: 110 }],
              color: "amber",
              noteMd: "A",
              runId: "run-A",
              toolCallId: "tc-A",
              createdAt: new Date().toISOString(),
            },
            {
              id: "ai-B",
              page: 5,
              bbox: [{ page: 5, x0: 30, y0: 200, x1: 40, y1: 210 }],
              color: "amber",
              noteMd: "B",
              runId: "run-B",
              toolCallId: "tc-B",
              createdAt: new Date().toISOString(),
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/api/papers/${PAPER_ID}/auto-highlight/runs`)) {
        return new Response(
          JSON.stringify({
            runs: [
              { id: "run-A", instruction: "A", summary: "A", highlightCount: 1 },
              { id: "run-B", instruction: "B", summary: "B", highlightCount: 1 },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/api/folders`)) {
        return new Response(JSON.stringify({ folders: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  window.requestAnimationFrame = originalRaf;
});

function drainRaf() {
  // Drain ALL queued rAF callbacks, including ones they enqueue, up to a cap.
  for (let i = 0; i < 100 && rafQueue.length > 0; i++) {
    const cbs = rafQueue;
    rafQueue = [];
    for (const cb of cbs) cb(performance.now());
  }
}

describe("Reader rAF poll cancellation (codex R-B review)", () => {
  it("rapid A→B click only scrolls to B, not stale A", async () => {
    render(<Reader paperId={PAPER_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /^Highlights$/ }));
    // Wait for runs to load — the row buttons use aria-label = summary.
    await screen.findByRole("button", { name: /^A$/ });

    // Set up DOM targets for BOTH A and B. The critical test: clicking A then
    // immediately B must NOT call scrollIntoView on A's element — A's poll
    // must be cancelled by the time rAF drains.
    const aEl = document.createElement("div");
    aEl.setAttribute("data-highlight-id", "ai-A");
    aEl.setAttribute("data-rect-index", "0");
    document.body.appendChild(aEl);
    const bEl = document.createElement("div");
    bEl.setAttribute("data-highlight-id", "ai-B");
    bEl.setAttribute("data-rect-index", "0");
    document.body.appendChild(bEl);

    // Click A's row label button. The Reader effect runs but the queued rAF
    // does NOT fire (manual queue). The pending scroll for A is now scheduled.
    const aButton = screen.getByRole("button", { name: /^A$/ });
    await act(async () => {
      fireEvent.click(aButton);
    });

    // Before any rAF fires, click B. The new pending scroll must invalidate
    // A's queued rAF token.
    const bButton = screen.getByRole("button", { name: /^B$/ });
    await act(async () => {
      fireEvent.click(bButton);
    });

    // Now drain rAFs. Without cancellation, A's queued tryScroll would find
    // aEl and call scrollIntoView on it — followed by B's tryScroll calling
    // scrollIntoView on bEl. With cancellation, only B's runs.
    await act(async () => {
      drainRaf();
      await new Promise((r) => setTimeout(r, 0));
      drainRaf();
    });

    // scrollIntoView should have fired exactly once, on B's element.
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(
      (scrollIntoViewSpy.mock.instances[0] as HTMLElement).getAttribute("data-highlight-id"),
    ).toBe("ai-B");

    aEl.remove();
    bEl.remove();
  });
});
