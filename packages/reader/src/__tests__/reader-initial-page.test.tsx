// @vitest-environment happy-dom
/**
 * BG2a follow-up — Reader consumes `initialPage` prop on mount and routes
 * through the same code path as the `episteme:reader-jump` listener
 * (setScrollTargetPage). Out-of-range pages (initialPage > totalPages) are
 * ignored. Verifies the prop-based deeplink replaces the prior
 * queueMicrotask/window-dispatch race.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { useReaderState } from "../hooks/use-reader-state";

// Stub out every heavy collaborator so Reader can mount in jsdom without
// hitting fetch, pdf.js, or the resizable-panels DOM contract.
vi.mock("react-resizable-panels", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { Group: Pass, Panel: Pass, Separator: () => null };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }));
vi.mock("../components/ReaderToolbar", () => ({ ReaderToolbar: () => null }));
vi.mock("../components/SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("../components/HighlightsSidebar", () => ({ HighlightsSidebar: () => null }));
vi.mock("../components/CommentsSidebar", () => ({ CommentsSidebar: () => null }));
vi.mock("../components/OutlineSidebar", () => ({ OutlineSidebar: () => null }));
vi.mock("../components/CitationsSidebar", () => ({ CitationsSidebar: () => null }));
vi.mock("../components/CitationCard", () => ({ CitationCard: () => null }));
vi.mock("../components/DockableSidebar", () => ({
  DockMenu: () => null,
  useSidebarDock: () => ["right", () => {}],
}));
vi.mock("../components/PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("../hooks/use-pdf-document", () => ({ usePdfDocument: () => ({ url: null }) }));
vi.mock("../hooks/use-text-selection", () => ({ useTextSelection: () => ({ selection: null, clearSelection: () => {} }) }));
vi.mock("../hooks/use-citation-click", () => ({
  useCitationClick: () => ({ activeCitation: null, clickPosition: null, dismiss: () => {} }),
}));
vi.mock("../hooks/use-user-highlights", () => ({
  useUserHighlights: () => ({ highlights: [], userHighlights: [], loading: false, error: null }),
}));
vi.mock("../hooks/use-paper-highlights", () => ({
  usePaperHighlights: () => ({ highlights: [], userHighlights: [], loading: false, error: null }),
}));
vi.mock("../lib/highlights-channel", () => ({ postHighlightsChange: () => {} }));

const scrollSpy = vi.fn();
vi.mock("../lib/scroll-to-segment", () => ({
  scrollContainerToSegmentWithRetry: (...args: unknown[]) => scrollSpy(...args),
}));

// fetch stub for the meta + folders + citations + markers + auto-runs hits
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    status: 200,
  }) as unknown as typeof fetch;
  useReaderState.setState({ totalPages: 0, scrollTargetPage: null, currentPage: 1 });
  scrollSpy.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Reader initialPage prop (BG2a follow-up)", () => {
  it("scrolls to initialPage=4 once totalPages is known", async () => {
    const { Reader } = await import("../components/Reader");
    render(<Reader paperId="p1" initialPage={4} />);

    // Simulate PdfViewer reporting totalPages — this is what triggers the
    // subscribe-based fallback inside Reader.
    act(() => {
      useReaderState.setState({ totalPages: 10 });
    });

    await waitFor(() => {
      expect(useReaderState.getState().scrollTargetPage).toBe(4);
    });
  });

  it("ignores out-of-range initialPage (999 on a 10-page doc)", async () => {
    const { Reader } = await import("../components/Reader");
    render(<Reader paperId="p2" initialPage={999} />);

    act(() => {
      useReaderState.setState({ totalPages: 10 });
    });

    // Give the subscribe + effect a tick.
    await new Promise((r) => setTimeout(r, 20));
    expect(useReaderState.getState().scrollTargetPage).toBeNull();
  });

  it("does not jump when initialPage is undefined", async () => {
    const { Reader } = await import("../components/Reader");
    render(<Reader paperId="p3" />);
    act(() => {
      useReaderState.setState({ totalPages: 10 });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(useReaderState.getState().scrollTargetPage).toBeNull();
  });
});
