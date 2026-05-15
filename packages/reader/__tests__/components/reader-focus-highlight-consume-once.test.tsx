import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent, screen, act } from "@testing-library/react";

// Stub PdfViewer (same approach as Reader.test.tsx) — react-pdf needs a real
// PDF + workers, neither of which JSDOM/happy-dom can supply.
vi.mock("../../src/components/PdfViewer", () => ({
  PdfViewer: () => <div data-testid="pdf-viewer-stub" />,
}));

import { Reader } from "../../src/components/Reader";
import { useReaderState } from "../../src/hooks/use-reader-state";

const PAPER_ID = "00000000-0000-0000-0000-000000000099";

let scrollIntoViewSpy: ReturnType<typeof vi.fn>;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

beforeEach(() => {
  useReaderState.setState({
    currentPage: 1,
    totalPages: 3,
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

  // Stub scrollIntoView on every Element to count calls.
  originalScrollIntoView = Element.prototype.scrollIntoView;
  scrollIntoViewSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;

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
              id: "ai-1",
              page: 1,
              bbox: [{ page: 1, x0: 10, y0: 100, x1: 20, y1: 110 }],
              color: "amber",
              noteMd: "AI highlight 1",
              runId: "run-1",
              toolCallId: "tc-1",
              createdAt: new Date().toISOString(),
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes(`/api/papers/${PAPER_ID}/auto-highlight/runs`)) {
        return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      }
      if (url.endsWith(`/api/folders`)) {
        return new Response(JSON.stringify({ folders: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function flushRaf() {
  // happy-dom RAF is sync-ish; this nudge gives the effect callback a chance.
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Bug 4: focusHighlightId is consumed once", () => {
  it("scrollIntoView fires exactly once after a chip click, even after an unrelated re-render", async () => {
    render(<Reader paperId={PAPER_ID} />);

    // Wait for paper-highlights fetch to resolve so the chip is present.
    fireEvent.click(await screen.findByRole("button", { name: /^Highlights$/ }));
    const chip = await screen.findByRole("button", { name: /AI highlight 1/i });

    // Add a target element matching the highlight id so scrollIntoView is callable
    // on a real element — mirrors what UserHighlightLayer renders in prod.
    const target = document.createElement("div");
    target.setAttribute("data-highlight-id", "ai-1");
    document.body.appendChild(target);

    // Click chip → sets focusHighlightId → effect schedules scrollIntoView.
    fireEvent.click(chip);
    await flushRaf();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

    // Now trigger an UNRELATED re-render that does not change focusHighlightId.
    // Cmd+F toggles findOpen state in Reader → re-render → mergedSidebarHighlights
    // gets rebuilt as a fresh array ref → effect dep changes → effect re-fires.
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await flushRaf();

    // Should STILL be 1 — focusHighlightId must be consumed once.
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

    target.remove();
  });
});
