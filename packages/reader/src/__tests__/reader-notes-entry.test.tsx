// @vitest-environment happy-dom
/**
 * Notes dock entry: Reader docks the `notesSlot` like its other panels, with
 * the wider notes sizes, and the toolbar's "Notes" button toggles it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

const dock = vi.hoisted(() => ({ notes: "right" }));

vi.mock("react-resizable-panels", () => {
  type Props = { id?: string; minSize?: string; defaultSize?: string; children?: React.ReactNode };
  const Group = ({ id, children }: Props) => <div data-group={id}>{children}</div>;
  const Panel = ({ id, minSize, defaultSize, children }: Props) => (
    <div data-panel={id} data-min={minSize} data-default={defaultSize}>
      {children}
    </div>
  );
  return { Group, Panel, Separator: () => null };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {} }) }));
vi.mock("../components/SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("../components/HighlightsSidebar", () => ({ HighlightsSidebar: () => null }));
vi.mock("../components/CommentsSidebar", () => ({ CommentsSidebar: () => null }));
vi.mock("../components/OutlineSidebar", () => ({ OutlineSidebar: () => null }));
vi.mock("../components/CitationsSidebar", () => ({ CitationsSidebar: () => null }));
vi.mock("../components/CitationCard", () => ({ CitationCard: () => null }));
vi.mock("../components/DockableSidebar", () => ({
  DockMenu: ({ onClose }: { onClose: () => void }) => (
    <button data-testid="dock-menu-close" onClick={onClose} />
  ),
  useSidebarDock: (id: string) => [id === "notes" ? dock.notes : "right", () => {}],
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

import { Reader } from "../components/Reader";

const notesSlot = (dockControl: React.ReactNode) => (
  <div data-testid="notes-slot">{dockControl}</div>
);

const notesPanel = () => document.querySelector<HTMLElement>('[data-panel="sidebar-notes"]');
const panelIds = (group: string) =>
  [...document.querySelectorAll(`[data-group="${group}"] > [data-panel]`)].map((el) =>
    el.getAttribute("data-panel"),
  );

beforeEach(() => {
  dock.notes = "right";
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    status: 200,
  }) as unknown as typeof fetch;
});

afterEach(cleanup);

describe("Reader notes entry", () => {
  it("shows no Notes button without a notesSlot", () => {
    render(<Reader paperId="p1" />);
    expect(screen.queryByTestId("reader-toolbar-notes")).toBeNull();
  });

  it("toggles the panel from the toolbar and closes it from the dock menu", () => {
    render(<Reader paperId="p1" notesSlot={notesSlot} />);
    expect(screen.queryByTestId("notes-slot")).toBeNull();

    fireEvent.click(screen.getByTestId("reader-toolbar-notes"));
    expect(screen.getByTestId("notes-slot")).toBeTruthy();

    fireEvent.click(screen.getByTestId("dock-menu-close"));
    expect(screen.queryByTestId("notes-slot")).toBeNull();
  });

  it("reports toggles to a controlling parent and follows its notesOpen", () => {
    const onNotesOpenChange = vi.fn();
    const { rerender } = render(
      <Reader paperId="p1" notesSlot={notesSlot} notesOpen={false} onNotesOpenChange={onNotesOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("reader-toolbar-notes"));
    expect(onNotesOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("notes-slot")).toBeNull();

    rerender(
      <Reader paperId="p1" notesSlot={notesSlot} notesOpen onNotesOpenChange={onNotesOpenChange} />,
    );
    expect(screen.getByTestId("notes-slot")).toBeTruthy();
  });

  it("docks right of the PDF with the notes sizes", () => {
    render(<Reader paperId="p1" notesSlot={notesSlot} notesOpen />);
    expect(panelIds("reader-horizontal")).toEqual(["pdf-viewer", "sidebar-notes"]);
    expect(notesPanel()?.dataset.min).toBe("360px");
    expect(notesPanel()?.dataset.default).toBe("35%");
  });

  it("docks left of the PDF with the notes sizes", () => {
    dock.notes = "left";
    render(<Reader paperId="p1" notesSlot={notesSlot} notesOpen />);
    expect(panelIds("reader-horizontal")).toEqual(["sidebar-notes", "pdf-viewer"]);
    expect(notesPanel()?.dataset.min).toBe("360px");
    expect(notesPanel()?.dataset.default).toBe("35%");
  });

  it("docks at the bottom and gives the bottom dock the notes height", () => {
    dock.notes = "bottom";
    render(<Reader paperId="p1" notesSlot={notesSlot} notesOpen />);
    expect(panelIds("reader-bottom-row")).toEqual(["sidebar-notes"]);
    const bottomDock = document.querySelector<HTMLElement>('[data-panel="reader-bottom-dock"]');
    expect(bottomDock?.dataset.min).toBe("240px");
    expect(bottomDock?.dataset.default).toBe("40%");
  });

  it("leaves the other panels' sizes alone", () => {
    render(<Reader paperId="p1" agentSlot={<div />} agentOpen />);
    const agent = document.querySelector<HTMLElement>('[data-panel="sidebar-agent"]');
    expect(agent?.dataset.min).toBe("280px");
    expect(agent?.dataset.default).toBe("25%");
  });
});
