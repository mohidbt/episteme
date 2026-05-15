import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";

// Stub PdfViewer (same approach as Reader.test.tsx) — react-pdf needs a real
// PDF + workers, neither of which JSDOM/happy-dom can supply.
vi.mock("../../src/components/PdfViewer", () => ({
  PdfViewer: () => <div data-testid="pdf-viewer-stub" />,
}));

import { Reader } from "../../src/components/Reader";
import { useReaderState } from "../../src/hooks/use-reader-state";

const PAPER_ID = "00000000-0000-0000-0000-000000000111";

let scrollIntoViewSpy: ReturnType<typeof vi.fn>;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

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
              id: "ai-multi",
              page: 3,
              bbox: [
                { page: 3, x0: 10, y0: 100, x1: 20, y1: 110 },
                { page: 5, x0: 30, y0: 200, x1: 40, y1: 210 },
                { page: 7, x0: 50, y0: 300, x1: 60, y1: 310 },
              ],
              color: "amber",
              noteMd: "Multi-rect highlight",
              runId: "run-multi",
              toolCallId: "tc-1",
              createdAt: new Date().toISOString(),
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/api/papers/${PAPER_ID}/auto-highlight/runs`)) {
        return new Response(JSON.stringify({ runs: [] }), { status: 200 });
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
});

function flushRaf() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Reader rect-aware scroll target (Bug 2b + 2c)", () => {
  it("clicking Next chip a second time scrolls to rect[1], not rect[0]", async () => {
    render(<Reader paperId={PAPER_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /^Highlights$/ }));
    await screen.findByRole("button", { name: /Multi-rect highlight/i });

    // Provide DOM targets for each rect index so the rect-aware query selector
    // resolves to a real, distinguishable element.
    const targets: HTMLDivElement[] = [];
    for (let i = 0; i < 3; i++) {
      const el = document.createElement("div");
      el.setAttribute("data-highlight-id", "ai-multi");
      el.setAttribute("data-rect-index", String(i));
      el.dataset.testIdx = String(i);
      document.body.appendChild(el);
      targets.push(el);
    }

    const next = screen.getByRole("button", { name: "Next highlight" });

    // First Next click → rect index 1. Reader must call scrollIntoView on the
    // element with [data-rect-index="1"], NOT rect 0.
    fireEvent.click(next);
    await flushRaf();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    const lastCallThis = scrollIntoViewSpy.mock.instances[0] as HTMLElement;
    expect(lastCallThis.getAttribute("data-rect-index")).toBe("1");

    // Page virtualization pre-warm — the rect[1] is on page 5, so the reader
    // should have set scrollTargetPage to 5 (not 3, which is rect[0]'s page).
    expect(useReaderState.getState().scrollTargetPage).toBe(5);

    // Second Next click → rect index 2 on page 7.
    fireEvent.click(next);
    await flushRaf();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2);
    const secondCallThis = scrollIntoViewSpy.mock.instances[1] as HTMLElement;
    expect(secondCallThis.getAttribute("data-rect-index")).toBe("2");
    expect(useReaderState.getState().scrollTargetPage).toBe(7);

    for (const t of targets) t.remove();
  });
});
