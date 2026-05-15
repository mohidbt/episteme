import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";

/**
 * Bug 1 (page-counter flicker) — integration test (Round C).
 *
 * Verifies the PdfViewer IntersectionObserver wiring:
 *
 * 1. When the MutationObserver re-runs `observe()` (e.g. placeholder ↔ PdfPage
 *    swap), the generation counter is bumped. Any callbacks still queued from
 *    the previous IO instance must NOT update currentPage.
 *
 * 2. Effect cleanup must ALSO bump the generation. Otherwise queued callbacks
 *    of the same generation-as-last-IO can still pass the guard after unmount
 *    / dep change.
 *
 * 3. Threshold list must include multiple values — a single 0.5 threshold
 *    misses page changes on tall/zoomed pages that never reach 50% visibility.
 *
 * Strategy: stub IntersectionObserver globally, capture per-instance callbacks
 * and option values, drive them manually, and spy on the zustand store action
 * `setCurrentPage`.
 */

// Storage polyfill (matches pdf-viewer.pinch.test pattern)
const storageStore = new Map<string, string>();
const storage: Storage = {
  get length() { return storageStore.size; },
  clear: () => storageStore.clear(),
  getItem: (k) => (storageStore.has(k) ? storageStore.get(k)! : null),
  key: (i) => Array.from(storageStore.keys())[i] ?? null,
  removeItem: (k) => { storageStore.delete(k); },
  setItem: (k, v) => { storageStore.set(k, String(v)); },
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });

vi.mock("react-pdf", () => ({
  Document: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));

vi.mock("../../src/hooks/use-pdf-text-selection", () => ({
  usePdfTextSelection: () => {},
}));

interface StubIO {
  cb: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[];
  disconnected: boolean;
}

const ioInstances: StubIO[] = [];

class FakeIntersectionObserver implements IntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
  private _self: StubIO;
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this._self = { cb, options, observed: [], disconnected: false };
    ioInstances.push(this._self);
  }
  observe(el: Element) { this._self.observed.push(el); }
  unobserve() { /* noop */ }
  disconnect() { this._self.disconnected = true; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

function makeEntry(pageNumber: number, ratio: number): IntersectionObserverEntry {
  const target = document.createElement("div");
  target.setAttribute("data-page-number", String(pageNumber));
  (target as HTMLElement).dataset.pageNumber = String(pageNumber);
  return {
    intersectionRatio: ratio,
    target,
    isIntersecting: ratio > 0,
    boundingClientRect: {} as DOMRectReadOnly,
    intersectionRect: {} as DOMRectReadOnly,
    rootBounds: null,
    time: 0,
  };
}

beforeEach(() => {
  ioInstances.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  // happy-dom ResizeObserver shim
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PdfViewer IO wiring (Bug 1 integration)", () => {
  it("threshold option is a graduated list, not a single value", async () => {
    const { PdfViewer } = await import("../../src/components/PdfViewer");
    const { useReaderState } = await import("../../src/hooks/use-reader-state");
    useReaderState.setState({ totalPages: 3, currentPage: 1 });

    render(<PdfViewer url="about:blank" />);

    // First IO is the one that matters
    expect(ioInstances.length).toBeGreaterThan(0);
    const first = ioInstances[0];
    const threshold = first.options?.threshold;
    expect(Array.isArray(threshold)).toBe(true);
    const arr = threshold as number[];
    // Must cover ratios where a tall/zoomed page may never hit 0.5
    expect(arr.length).toBeGreaterThanOrEqual(3);
    expect(arr).toContain(0);
    expect(arr).toContain(0.25);
    expect(arr).toContain(0.75);
  });

  it("stale GEN-1 callbacks are ignored after MutationObserver re-observes", async () => {
    const { PdfViewer } = await import("../../src/components/PdfViewer");
    const { useReaderState } = await import("../../src/hooks/use-reader-state");
    useReaderState.setState({ totalPages: 3, currentPage: 1 });

    const setCurrentPageSpy = vi.fn();
    useReaderState.setState({ setCurrentPage: setCurrentPageSpy });

    const { container } = render(<PdfViewer url="about:blank" />);

    // GEN-1 IO captured at mount
    expect(ioInstances.length).toBe(1);
    const gen1 = ioInstances[0];

    // Trigger MutationObserver: add a child to the container subtree to
    // cause `observe()` to re-run, bumping the generation and creating GEN-2.
    const containerEl = container.querySelector("[data-pdf-container]") as HTMLElement;
    expect(containerEl).toBeTruthy();
    await act(async () => {
      const dummy = document.createElement("div");
      dummy.setAttribute("data-page-number", "1");
      containerEl.appendChild(dummy);
      // happy-dom drives MutationObserver synchronously inside microtasks
      await Promise.resolve();
    });

    expect(ioInstances.length).toBeGreaterThanOrEqual(2);
    const gen2 = ioInstances[ioInstances.length - 1];
    expect(gen2).not.toBe(gen1);

    // Invoke GEN-1 callback now — it's stale.
    act(() => {
      gen1.cb([makeEntry(3, 0.9)], gen1 as unknown as IntersectionObserver);
    });
    expect(setCurrentPageSpy).not.toHaveBeenCalledWith(3);

    // Invoke GEN-2 callback with a different page — must be honored.
    act(() => {
      gen2.cb([makeEntry(2, 0.9)], gen2 as unknown as IntersectionObserver);
    });
    expect(setCurrentPageSpy).toHaveBeenCalledWith(2);
  });

  it("cleanup bumps generation: queued callbacks after unmount are stale", async () => {
    const { PdfViewer } = await import("../../src/components/PdfViewer");
    const { useReaderState } = await import("../../src/hooks/use-reader-state");
    useReaderState.setState({ totalPages: 3, currentPage: 1 });

    const setCurrentPageSpy = vi.fn();
    useReaderState.setState({ setCurrentPage: setCurrentPageSpy });

    const { unmount } = render(<PdfViewer url="about:blank" />);
    expect(ioInstances.length).toBe(1);
    const gen1 = ioInstances[0];

    // Simulate a queued IO callback that arrives AFTER the cleanup runs.
    // Without the cleanup-side generation bump, this callback's captured
    // generation still matches `ioGenerationRef.current` and the entry
    // sneaks through to setCurrentPage.
    unmount();

    act(() => {
      gen1.cb([makeEntry(3, 0.9)], gen1 as unknown as IntersectionObserver);
    });
    expect(setCurrentPageSpy).not.toHaveBeenCalled();
  });
});
