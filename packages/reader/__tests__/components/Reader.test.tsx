import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

// Stub PdfViewer — react-pdf needs a real PDF + workers, neither of which a
// JSDOM smoke test can supply. The point here is to assert the composer's
// root attrs render, not to exercise PDF.js.
vi.mock("../../src/components/PdfViewer", () => ({
  PdfViewer: () => <div data-testid="pdf-viewer-stub" />,
}));

import { Reader } from "../../src/components/Reader";

const PAPER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
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
});
