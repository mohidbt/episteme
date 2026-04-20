import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";

// Install a minimal Storage polyfill before importing anything that reads localStorage
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

vi.mock("@/hooks/use-pdf-text-selection", () => ({
  usePdfTextSelection: () => {},
}));

afterEach(() => cleanup());

describe("PdfViewer pinch zoom", () => {
  it("ctrl+wheel up increases zoom, down decreases", async () => {
    const { PdfViewer } = await import("../pdf-viewer");
    const { useReaderState } = await import("@/hooks/use-reader-state");
    useReaderState.setState({ zoom: 1.0 });
    const { container } = render(<PdfViewer url="about:blank" />);
    const el = container.querySelector(".overflow-auto") as HTMLElement;
    expect(el).toBeTruthy();
    const fire = (deltaY: number) => {
      const ev = new Event("wheel", { bubbles: true, cancelable: true }) as WheelEvent;
      Object.defineProperty(ev, "deltaY", { value: deltaY });
      Object.defineProperty(ev, "ctrlKey", { value: true });
      el.dispatchEvent(ev);
    };
    fire(-100);
    expect(useReaderState.getState().zoom).toBeGreaterThan(1.0);
    const afterUp = useReaderState.getState().zoom;
    fire(100);
    expect(useReaderState.getState().zoom).toBeLessThan(afterUp);
  });
});
