// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
  waitFor,
  act,
} from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => refreshMock(),
    push: (url: string) => pushMock(url),
  }),
  usePathname: () => "/",
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (msg: string) => toastErrorMock(msg),
    success: () => {},
  },
}));

import { FileBrowser, rectsIntersect, resolveDrop } from "./FileBrowser";
import type { FolderContents } from "@/lib/folders-server";
import type { FolderRow } from "@/lib/folders";

// updatedAt must be a serializable form for RSC boundary, but the component
// accepts either Date or string/number; here we use Date for the test since
// FolderContents type uses Date — serialization happens in the page, not here.
const NOW = new Date("2026-04-20T10:00:00.000Z");

const baseContents: FolderContents = {
  folders: [
    {
      id: "f1",
      name: "Research",
      isTrash: false,
      sortOrder: 0,
      updatedAt: NOW,
    },
  ],
  papers: [
    {
      kind: "paper",
      id: "p1",
      title: "On Attention",
      folderId: null,
      updatedAt: NOW,
    },
  ],
  references: [],
  assets: [
    {
      kind: "asset",
      id: "a1",
      filename: "diagram.png",
      mimeType: "image/png",
      folderId: null,
      updatedAt: NOW,
    },
  ],
  notes: [
    {
      kind: "note",
      id: "n1",
      title: "My note",
      folderId: null,
      slug: "my-note",
      updatedAt: NOW,
    },
  ],
  papersets: [],
};

const baseFolders: FolderRow[] = [
  { id: "f1", parentId: null, name: "Research", isTrash: false },
];

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  refreshMock.mockReset();
  toastErrorMock.mockReset();
});

describe("FileBrowser", () => {
  it("renders three items in tile view by default", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("On Attention")).toBeTruthy();
    expect(screen.getByText("My note")).toBeTruthy();
    // Assets land in the Drive list alongside papers/notes.
    expect(screen.getByText("diagram.png")).toBeTruthy();
    expect(screen.getByTestId("fb-item-a1")).toBeTruthy();
  });

  it("clicking a folder navigates to /drive/<encoded name>", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
    const folderEl = screen.getByTestId("fb-item-f1");
    fireEvent.click(folderEl);
    expect(pushMock).toHaveBeenCalledWith(
      `/drive/${encodeURIComponent("Research")}`,
    );
  });

  it("note link href points to /n/<slug>", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
    const note = screen.getByTestId("fb-item-n1");
    const anchor =
      note.tagName === "A" ? note : (note.querySelector("a") as HTMLElement);
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute("href")).toBe("/n/my-note");
  });

  it("toggling to list view renders a table with Name/Type/Updated columns", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
    fireEvent.click(screen.getByTestId("fb-view-list"));
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const headerText = headers.map((h) => h.textContent);
    expect(headerText).toEqual(["Name", "Type", "Updated"]);
    expect(within(table).getByText("Research")).toBeTruthy();
    expect(within(table).getByText("On Attention")).toBeTruthy();
    expect(within(table).getByText("My note")).toBeTruthy();
  });

  it("list view has no div between tbody and tr (regression: invalid HTML nesting)", () => {
    const { container } = render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
    fireEvent.click(screen.getByTestId("fb-view-list"));
    // There must be no div directly inside tbody — that would be invalid HTML.
    expect(container.querySelector("tbody > div")).toBeNull();
    // And items must still appear as rows inside tbody.
    const tbody = container.querySelector("tbody");
    expect(tbody).toBeTruthy();
    const rows = tbody!.querySelectorAll("tr");
    // 4 items in baseContents (folder f1, paper p1, note n1, asset a1)
    expect(rows.length).toBe(4);
  });

  it("renders empty state when no items", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={{ folders: [], papers: [], references: [], notes: [], assets: [], papersets: [] }}
        folders={[]}
      />,
    );
    expect(
      screen.getByText(/Drop files here, or click/i),
    ).toBeTruthy();
  });
});

describe("FileBrowser selection", () => {
  function renderFb() {
    return render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
  }

  it("plain click selects only that item (data-selected=true)", () => {
    renderFb();
    const p1 = screen.getByTestId("fb-item-p1");
    fireEvent.click(p1);
    expect(p1.getAttribute("data-selected")).toBe("true");
    expect(
      screen.getByTestId("fb-item-f1").getAttribute("data-selected"),
    ).not.toBe("true");
    expect(
      screen.getByTestId("fb-item-n1").getAttribute("data-selected"),
    ).not.toBe("true");
  });

  it("shift-click extends range between anchor and clicked item in visible order", () => {
    renderFb();
    // Visible order from flatten(): folder f1, paper p1, note n1.
    fireEvent.click(screen.getByTestId("fb-item-f1"));
    fireEvent.click(screen.getByTestId("fb-item-n1"), { shiftKey: true });
    expect(screen.getByTestId("fb-item-f1").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("fb-item-p1").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("fb-item-n1").getAttribute("data-selected")).toBe("true");
  });

  it("cmd-click toggles membership (adds then removes)", () => {
    renderFb();
    fireEvent.click(screen.getByTestId("fb-item-f1"));
    fireEvent.click(screen.getByTestId("fb-item-p1"), { metaKey: true });
    expect(screen.getByTestId("fb-item-f1").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("fb-item-p1").getAttribute("data-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("fb-item-p1"), { metaKey: true });
    expect(screen.getByTestId("fb-item-p1").getAttribute("data-selected")).not.toBe("true");
    expect(screen.getByTestId("fb-item-f1").getAttribute("data-selected")).toBe("true");
  });

  it("clicking the empty grid area clears selection", () => {
    renderFb();
    const p1 = screen.getByTestId("fb-item-p1");
    fireEvent.click(p1);
    expect(p1.getAttribute("data-selected")).toBe("true");
    const root = screen.getByTestId("fb-root");
    fireEvent.click(root, { target: root });
    // With no item clicked, clicking the root div itself clears.
    // Simulate by firing on root element directly.
    fireEvent.click(root);
    expect(
      screen.getByTestId("fb-item-p1").getAttribute("data-selected"),
    ).not.toBe("true");
  });
});

describe("FileBrowser keyboard", () => {
  function renderFb() {
    return render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
  }

  beforeEach(() => {
    // @ts-expect-error jsdom global
    global.fetch = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
  });

  it("ArrowDown moves selection to next item in visible order", () => {
    renderFb();
    fireEvent.click(screen.getByTestId("fb-item-f1"));
    const root = screen.getByTestId("fb-root");
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(screen.getByTestId("fb-item-p1").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("fb-item-f1").getAttribute("data-selected")).not.toBe("true");
  });

  it("Enter on selected leaf calls router.push to its href", () => {
    renderFb();
    fireEvent.click(screen.getByTestId("fb-item-n1"));
    const root = screen.getByTestId("fb-root");
    fireEvent.keyDown(root, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/n/my-note");
  });

  it("Del key with selection POSTs /api/folders/trash for each selected", async () => {
    renderFb();
    fireEvent.click(screen.getByTestId("fb-item-p1"));
    fireEvent.click(screen.getByTestId("fb-item-n1"), { metaKey: true });
    const root = screen.getByTestId("fb-root");
    fireEvent.keyDown(root, { key: "Delete" });
    // Wait one microtask flush for the async fetch promises to fire
    await Promise.resolve();
    await Promise.resolve();
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const trashCalls = calls.filter((c) => String(c[0]).includes("/api/folders/trash"));
    expect(trashCalls.length).toBe(2);
  });
});

describe("rectsIntersect", () => {
  it("overlapping rects return true", () => {
    expect(
      rectsIntersect(
        { x0: 0, y0: 0, x1: 10, y1: 10 },
        { x0: 5, y0: 5, x1: 15, y1: 15 },
      ),
    ).toBe(true);
  });
  it("disjoint rects return false", () => {
    expect(
      rectsIntersect(
        { x0: 0, y0: 0, x1: 10, y1: 10 },
        { x0: 20, y0: 20, x1: 30, y1: 30 },
      ),
    ).toBe(false);
  });
  it("edge-only contact returns false", () => {
    expect(
      rectsIntersect(
        { x0: 0, y0: 0, x1: 10, y1: 10 },
        { x0: 10, y0: 0, x1: 20, y1: 10 },
      ),
    ).toBe(false);
  });
  it("normalizes inverted coords (drag up-left)", () => {
    expect(
      rectsIntersect(
        { x0: 10, y0: 10, x1: 0, y1: 0 },
        { x0: 5, y0: 5, x1: 15, y1: 15 },
      ),
    ).toBe(true);
  });
});

describe("FileBrowser resolveDrop", () => {
  beforeEach(() => {
    // @ts-expect-error jsdom
    global.fetch = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
  });

  it("leaf → folder PATCHes /api/<kind>/:id with folderId=target.id", async () => {
    const folders: FolderRow[] = [
      { id: "f1", parentId: null, name: "Research", isTrash: false },
    ];
    await resolveDrop(
      {
        kind: "leaf",
        itemKind: "paper",
        id: "p1",
        title: "p",
        currentFolderId: null,
      },
      { kind: "folder", id: "f1" },
      folders,
    );
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0][0]).toBe("/api/papers/p1");
    const opts = calls[0][1] as { method: string; body: string };
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ folderId: "f1" });
  });

  it("paperset leaf → folder PATCHes /api/papersets/:id with folderId=target.id", async () => {
    const folders: FolderRow[] = [
      { id: "f1", parentId: null, name: "Research", isTrash: false },
    ];
    await resolveDrop(
      {
        kind: "leaf",
        itemKind: "paperset",
        id: "ps1",
        title: "My set",
        currentFolderId: null,
      },
      { kind: "folder", id: "f1" },
      folders,
    );
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0][0]).toBe("/api/papersets/ps1");
    const opts = calls[0][1] as { method: string; body: string };
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ folderId: "f1" });
  });

  it("folder → descendant is rejected with toast and no fetch", async () => {
    const folders: FolderRow[] = [
      { id: "a", parentId: null, name: "A", isTrash: false },
      { id: "b", parentId: "a", name: "B", isTrash: false },
    ];
    await resolveDrop(
      { kind: "folder", id: "a", title: "A", currentFolderId: null },
      { kind: "folder", id: "b" },
      folders,
    );
    expect(toastErrorMock).toHaveBeenCalledWith("Cannot move folder into itself");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("folder → non-descendant POSTs /api/folders/move", async () => {
    const folders: FolderRow[] = [
      { id: "a", parentId: null, name: "A", isTrash: false },
      { id: "b", parentId: null, name: "B", isTrash: false },
    ];
    await resolveDrop(
      { kind: "folder", id: "a", title: "A", currentFolderId: null },
      { kind: "folder", id: "b" },
      folders,
    );
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0][0]).toBe("/api/folders/move");
    const opts = calls[0][1] as { method: string; body: string };
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ folderId: "a", targetParentId: "b" });
  });
});

// ── Toolbar trash-view tests (T20) ──────────────────────────────────────────
describe("FileBrowserToolbar isTrashView (T20)", () => {
  it("isTrashView=true shows 'Empty trash' button and 'In Trash' badge, hides New menu in toolbar", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId="trash-folder-id"
        folderChain={[{ id: "trash-folder-id", name: "Trash" }]}
        contents={baseContents}
        folders={baseFolders}
        isTrashView={true}
        onEmptyTrash={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /empty trash/i })).toBeTruthy();
    expect(screen.getByText(/in trash/i)).toBeTruthy();
    // The toolbar "New" button (aria-label="New") should not exist
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
  });

  it("isTrashView=false (default) shows New menu and hides Empty trash / In Trash badge", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
      />,
    );
    expect(screen.queryByRole("button", { name: /empty trash/i })).toBeNull();
    expect(screen.queryByText(/in trash/i)).toBeNull();
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
  });
});

// ── Context-menu tests (T19) ─────────────────────────────────────────────────
describe("FileBrowser context menu (T19)", () => {
  beforeEach(() => {
    // @ts-expect-error jsdom global
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  });

  function renderFb(isTrashView = false) {
    return render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
        folders={baseFolders}
        isTrashView={isTrashView}
      />,
    );
  }

  it("right-click on folder in non-trash context shows Rename and Move to…", async () => {
    renderFb(false);
    const folderEl = screen.getByTestId("fb-item-f1");
    await act(async () => {
      fireEvent.contextMenu(folderEl);
    });
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Move to…" })).toBeTruthy();
    });
  });

  it("clicking Move to… in context menu opens MoveToDialog with title 'Move to folder'", async () => {
    renderFb(false);
    const folderEl = screen.getByTestId("fb-item-f1");
    await act(async () => {
      fireEvent.contextMenu(folderEl);
    });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Move to…" })).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    });
    await waitFor(() => {
      expect(screen.getByText("Move to folder")).toBeTruthy();
    });
  });

  it("right-click on paper inside trash shows Restore and Delete permanently instead of Rename/Move/Trash", async () => {
    renderFb(true);
    const paperEl = screen.getByTestId("fb-item-p1");
    await act(async () => {
      fireEvent.contextMenu(paperEl);
    });
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Restore" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: "Delete permanently" })).toBeTruthy();
    });
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move to…" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move to Trash" })).toBeNull();
  });
});
