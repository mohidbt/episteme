// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { FolderRow } from "@/lib/folders";
import { resolveSidebarDrop } from "./DriveTree";
import type { SidebarDragActive, SidebarDragOver } from "./DriveTree";

// Mock next/navigation for render tests
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (msg: string) => toastErrorMock(msg),
    success: () => {},
  },
}));

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// Stub localStorage / matchMedia for SidebarProvider
beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (
    typeof window.localStorage === "undefined" ||
    typeof window.localStorage.getItem !== "function"
  ) {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
      },
    });
  }
});

// ── DriveTree render ──────────────────────────────────────────────────────────

import { DriveTree } from "./DriveTree";

const STORAGE_NS = "km.sidebar.expand.v1";

function makeDriveTree(overrides: Partial<Parameters<typeof DriveTree>[0]> = {}) {
  return (
    <SidebarProvider>
      <DriveTree
        libraryId={1}
        folders={[{ id: "f1", name: "Research", isTrash: false, parentId: null, sortOrder: 0 }]}
        papers={[{ id: "p1", title: "On Attention", folderId: null }]}
        references={[]}
        notes={[]}
        papersets={[]}
        trashId={null}
        onMutate={() => {}}
        {...overrides}
      />
    </SidebarProvider>
  );
}

describe("DriveTree render", () => {
  it("renders Drive label visible at all times", () => {
    render(makeDriveTree());
    expect(screen.getByText("Drive")).toBeTruthy();
  });

  it("is collapsed by default — body items are hidden", () => {
    render(makeDriveTree());
    expect(screen.queryByText("Research")).toBeNull();
    expect(screen.queryByText("On Attention")).toBeNull();
  });

  it("Drive label is clickable and toggles expansion", () => {
    render(makeDriveTree());
    // Default: collapsed — content hidden
    expect(screen.queryByText("Research")).toBeNull();
    // Click the Drive label toggle button
    const toggle = screen.getByRole("button", { name: /drive/i });
    fireEvent.click(toggle);
    // Now expanded — content visible
    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("On Attention")).toBeTruthy();
  });

  it("renders papersets at root with /d/<id> href", () => {
    render(
      makeDriveTree({
        papersets: [{ id: "ps1", title: "My Paperset", folderId: null }],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /drive/i }));
    const link = screen.getByText("My Paperset").closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/d/ps1");
  });

  it("renders Table2 icon next to paperset leaves (K5c)", () => {
    render(
      makeDriveTree({
        papersets: [{ id: "ps1", title: "My Paperset", folderId: null }],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /drive/i }));
    expect(screen.getByTestId("drive-icon-paperset")).toBeTruthy();
  });

  it("expansion state persists in localStorage", async () => {
    const { unmount } = render(makeDriveTree());
    const toggle = screen.getByRole("button", { name: /drive/i });
    fireEvent.click(toggle);
    // localStorage should have truthy value for drive:root key
    const raw = window.localStorage.getItem(STORAGE_NS);
    const stored = raw ? JSON.parse(raw) : {};
    expect(stored["1:drive:root"]).toBe(true);
    unmount();
    // Remount — state should be restored (expanded) after effects fire
    await act(async () => { render(makeDriveTree()); });
    expect(screen.getByText("Research")).toBeTruthy();
  });
});

// ── resolveSidebarDrop unit tests ─────────────────────────────────────────────

describe("resolveSidebarDrop", () => {
  beforeEach(() => {
    // @ts-expect-error jsdom global
    global.fetch = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
  });

  // Test case 1: leaf → folder PATCHes /api/<kind>/:id with { folderId }
  it("leaf → folder PATCHes /api/papers/:id with { folderId }", async () => {
    const folders: FolderRow[] = [
      { id: "f1", parentId: null, name: "Research", isTrash: false },
    ];
    const active: SidebarDragActive = {
      kind: "leaf",
      itemKind: "paper",
      id: "p1",
      title: "On Attention",
      folderId: null,
    };
    const over: SidebarDragOver = {
      kind: "folder",
      folderId: "f1",
    };

    await resolveSidebarDrop(active, over, folders);

    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("/api/papers/p1");
    const opts = calls[0][1] as { method: string; body: string };
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ folderId: "f1" });
  });

  // Test case 2: folder → descendant is rejected with toast, no fetch
  it("folder → ancestor of target fires toast.error and does NOT fetch", async () => {
    const folders: FolderRow[] = [
      { id: "a", parentId: null, name: "A", isTrash: false },
      { id: "b", parentId: "a", name: "B", isTrash: false },
    ];
    const active: SidebarDragActive = {
      kind: "folder",
      id: "a",
      folderId: "a",
      title: "A",
    };
    const over: SidebarDragOver = {
      kind: "folder",
      folderId: "b",
    };

    await resolveSidebarDrop(active, over, folders);

    expect(toastErrorMock).toHaveBeenCalledWith("Cannot move folder into itself");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Test case 3: leaf → trash POSTs /api/folders/trash
  it("leaf → trash POSTs /api/folders/trash with { target: { kind, id } }", async () => {
    const folders: FolderRow[] = [
      { id: "trash1", parentId: null, name: "Trash", isTrash: true },
    ];
    const active: SidebarDragActive = {
      kind: "leaf",
      itemKind: "note",
      id: "n1",
      title: "My note",
      folderId: null,
    };
    const over: SidebarDragOver = {
      kind: "trash",
      folderId: "trash1",
    };

    await resolveSidebarDrop(active, over, folders, 1);

    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("/api/folders/trash");
    const opts = calls[0][1] as { method: string; body: string };
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      libraryId: 1,
      target: { kind: "note", id: "n1" },
    });
  });

  // Bonus: no-op when dropping leaf onto same folder
  it("leaf dropped onto same folder is a no-op (no fetch)", async () => {
    const folders: FolderRow[] = [
      { id: "f1", parentId: null, name: "Research", isTrash: false },
    ];
    const active: SidebarDragActive = {
      kind: "leaf",
      itemKind: "paper",
      id: "p1",
      title: "Paper",
      folderId: "f1",
    };
    const over: SidebarDragOver = {
      kind: "folder",
      folderId: "f1",
    };

    await resolveSidebarDrop(active, over, folders);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  // folder → root (null) POSTs /api/folders/move with targetParentId=null
  it("folder → root droppable POSTs /api/folders/move with targetParentId=null", async () => {
    // f2 lives inside f1; dropping f2 onto root should call folders/move
    const folders: FolderRow[] = [
      { id: "f1", parentId: null, name: "A", isTrash: false },
      { id: "f2", parentId: "f1", name: "B", isTrash: false },
    ];
    const active: SidebarDragActive = {
      kind: "folder",
      id: "f2",
      folderId: "f2",
      title: "B",
    };
    const over: SidebarDragOver = {
      kind: "root",
      folderId: null,
    };

    await resolveSidebarDrop(active, over, folders);

    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("/api/folders/move");
    const opts = calls[0][1] as { method: string; body: string };
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ folderId: "f2", targetParentId: null });
  });
});
