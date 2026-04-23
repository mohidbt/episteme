// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarShell } from "./SidebarShell";
import type { TreeResponse } from "@/lib/tree-server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/",
}));

const TRASH_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function baseTree(overrides?: Partial<TreeResponse>): TreeResponse {
  return {
    library: { id: 1, name: "My Library" },
    folders: [
      {
        id: TRASH_ID,
        name: "Trash",
        parentId: null,
        isTrash: true,
        sortOrder: 0,
      },
    ],
    papers: [],
    references: [],
    notes: [],
    agent: [
      { kind: "skills", label: "skills.md" },
      { kind: "memory", label: "memory.md" },
      { kind: "settings", label: "settings.json" },
    ],
    ...overrides,
  };
}

function renderShell(tree: TreeResponse) {
  return render(
    <SidebarProvider>
      <SidebarShell library={tree.library} tree={tree} />
    </SidebarProvider>,
  );
}

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
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sidebar", () => {
  it("renders 4 top-level group labels: Drive, By type, Agent, Settings", () => {
    renderShell(baseTree());
    expect(screen.getByText("Drive")).toBeTruthy();
    expect(screen.getByText("By type")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("By type exposes 4 links with correct hrefs", () => {
    const { container } = renderShell(baseTree());
    const byHref = (h: string) =>
      container.querySelector(`a[href="${h}"]`) as HTMLAnchorElement | null;
    expect(byHref("/papers")?.textContent).toMatch(/papers/i);
    expect(byHref("/references")?.textContent).toMatch(/references/i);
    expect(byHref("/notes")?.textContent).toMatch(/notes/i);
    const dataLink = byHref("/data");
    expect(dataLink).toBeTruthy();
    expect(dataLink?.textContent).toMatch(/data/i);
  });

  it("renders Trash row at bottom of Drive with sidebar-trash testid", () => {
    renderShell(baseTree());
    const trash = screen.getByTestId("sidebar-trash");
    expect(trash).toBeTruthy();
    expect(within(trash).getByText("Trash")).toBeTruthy();
  });

  it("shows badge dot when any item sits in the Trash folder", () => {
    const tree = baseTree({
      notes: [
        {
          id: "n1",
          title: "trashed note",
          slug: "trashed-note",
          folderId: TRASH_ID,
        },
      ],
    });
    renderShell(tree);
    expect(screen.queryByTestId("sidebar-trash-badge")).toBeTruthy();
  });

  it("hides badge dot when Trash is empty", () => {
    renderShell(baseTree());
    expect(screen.queryByTestId("sidebar-trash-badge")).toBeNull();
  });
});
