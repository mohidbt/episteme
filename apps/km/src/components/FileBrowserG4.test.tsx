// @vitest-environment jsdom
// G4 — Drive polish tests (Tasks #16, #22, #25, #47)
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => refreshMock(),
    push: (url: string) => pushMock(url),
  }),
  usePathname: () => "/",
}));

vi.mock("sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));

import { FileBrowser } from "./FileBrowser";
import { PathPill } from "./PathPill";
import type { FolderContents } from "@/lib/folders-server";
import type { FolderRow } from "@/lib/folders";

const NOW = new Date("2026-04-20T10:00:00.000Z");

const allKindsContents: FolderContents = {
  folders: [{ id: "f1", name: "Research", isTrash: false, sortOrder: 0, updatedAt: NOW }],
  papers: [{ kind: "paper", id: "p1", title: "Paper One", folderId: null, updatedAt: NOW }],
  references: [
    {
      kind: "reference",
      id: "ref1",
      title: "Smith2020",
      folderId: null,
      updatedAt: NOW,
    } as FolderContents["references"][number],
  ],
  notes: [
    { kind: "note", id: "n1", title: "Note One", folderId: null, slug: "note-one", updatedAt: NOW },
  ],
  assets: [],
  papersets: [
    { kind: "paperset", id: "ps1", filename: "Set Alpha", folderId: null, updatedAt: NOW },
  ],
};

const folders: FolderRow[] = [
  { id: "f1", parentId: null, name: "Research", isTrash: false },
];

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  refreshMock.mockReset();
});

describe("G4 #16 — Drive cmd+click opens in new tab", () => {
  it("tile-view leaf with href is wrapped in <Link href> so cmd+click opens new tab natively", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={allKindsContents}
        folders={folders}
      />,
    );
    const tile = screen.getByTestId("fb-item-p1");
    // The tile must be (or contain) an anchor with the proper href.
    const anchor =
      tile.tagName === "A" ? tile : tile.closest("a") ?? tile.querySelector("a");
    expect(anchor).toBeTruthy();
    expect((anchor as HTMLAnchorElement).getAttribute("href")).toBe("/p/p1");
  });

  it("meta+click on a tile leaf does NOT preventDefault (lets browser open new tab)", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={allKindsContents}
        folders={folders}
      />,
    );
    const tile = screen.getByTestId("fb-item-p1");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 });
    tile.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("list-view: meta+click on a leaf link does NOT preventDefault", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={allKindsContents}
        folders={folders}
      />,
    );
    fireEvent.click(screen.getByTestId("fb-view-list"));
    const row = screen.getByTestId("fb-item-p1");
    const link = row.querySelector("a");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/p/p1");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true, button: 0 });
    link!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("G4 #22 + #47 — Unified drive icons (folder/paper/note/reference/paperset)", () => {
  it("list view renders all 5 kind icons as <svg> with size-4 class (lucide-react default 2px stroke)", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={allKindsContents}
        folders={folders}
      />,
    );
    fireEvent.click(screen.getByTestId("fb-view-list"));

    const ids = ["f1", "p1", "n1", "ref1", "ps1"];
    const sizes: string[] = [];
    const strokes: string[] = [];
    const lucideMarker: boolean[] = [];
    for (const id of ids) {
      const row = screen.getByTestId(`fb-item-${id}`);
      const svg = row.querySelector("svg");
      expect(svg).toBeTruthy();
      // Same library: every icon has the "lucide" base class.
      lucideMarker.push(svg!.classList.contains("lucide"));
      // Same size token.
      expect(svg!.classList.contains("size-4")).toBe(true);
      sizes.push("size-4");
      strokes.push(svg!.getAttribute("stroke-width") ?? "2");
    }
    // All 5 must be from lucide (same library).
    expect(lucideMarker.every(Boolean)).toBe(true);
    // All 5 must share the exact same stroke-width.
    expect(new Set(strokes).size).toBe(1);
    // And the same size token.
    expect(new Set(sizes).size).toBe(1);
  });

  it("paperset row has a kind icon present in list view (Task #47)", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={allKindsContents}
        folders={folders}
      />,
    );
    fireEvent.click(screen.getByTestId("fb-view-list"));
    const row = screen.getByTestId("fb-item-ps1");
    const svg = row.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.classList.contains("size-4")).toBe(true);
  });
});

describe("G4 #25 — Drive nav pill reuses ToggleGroup-style pill component", () => {
  it("PathPill renders with the shared 'nav-pill' marker so the same component family is used as the list/tile switcher", () => {
    const { container } = render(
      <PathPill
        segments={[
          { id: "root", label: "Default", href: "/" },
          { id: "title", label: "Folder A", href: null },
        ]}
      />,
    );
    // After Task #25 the PathPill outer container exposes data-slot="nav-pill"
    // (matches the design-system pill primitive) so it can be styled/tested 1:1
    // with the view switcher.
    const pill = container.querySelector("[data-slot='nav-pill']");
    expect(pill).toBeTruthy();
  });
});
