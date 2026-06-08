import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// localStorage polyfill (PdfViewer's dock hooks read it via dependencies).
const store = new Map<string, string>();
const storage: Storage = {
  get length() { return store.size; },
  clear: () => store.clear(),
  getItem: (k) => (store.has(k) ? store.get(k)! : null),
  key: (i) => Array.from(store.keys())[i] ?? null,
  removeItem: (k) => { store.delete(k); },
  setItem: (k, v) => { store.set(k, String(v)); },
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PdfViewer zoom debounce (GSD-25)", () => {
  it("ctrl+wheel updates live zoom immediately but defers renderZoom until idle", async () => {
    vi.useFakeTimers();
    const { PdfViewer } = await import("../../src/components/PdfViewer");
    const { useReaderState } = await import("../../src/hooks/use-reader-state");
    useReaderState.setState({ zoom: 1.0, renderZoom: 1.0 });
    const { container } = render(<PdfViewer url="about:blank" />);
    const el = container.querySelector(".overflow-auto") as HTMLElement;

    const fire = (deltaY: number) => {
      const ev = new Event("wheel", { bubbles: true, cancelable: true }) as WheelEvent;
      Object.defineProperty(ev, "deltaY", { value: deltaY });
      Object.defineProperty(ev, "ctrlKey", { value: true });
      el.dispatchEvent(ev);
    };

    // Burst of wheel events — live zoom moves every tick.
    for (let i = 0; i < 10; i += 1) fire(-50);
    const liveAfterBurst = useReaderState.getState().zoom;
    const renderAfterBurst = useReaderState.getState().renderZoom;
    expect(liveAfterBurst).toBeGreaterThan(1.0);
    // renderZoom must NOT have moved yet — debounce is in flight.
    expect(renderAfterBurst).toBe(1.0);

    // Settle the debounce window.
    vi.advanceTimersByTime(200);
    expect(useReaderState.getState().renderZoom).toBeCloseTo(liveAfterBurst, 5);
  });

  it("zoomIn/zoomOut button commits renderZoom immediately (no debounce)", async () => {
    const { useReaderState } = await import("../../src/hooks/use-reader-state");
    useReaderState.setState({ zoom: 1.0, renderZoom: 1.0 });
    useReaderState.getState().zoomIn();
    const s = useReaderState.getState();
    expect(s.zoom).toBeCloseTo(1.25, 5);
    expect(s.renderZoom).toBeCloseTo(1.25, 5);
  });
});
