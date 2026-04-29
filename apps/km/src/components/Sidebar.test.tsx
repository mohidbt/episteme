// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
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

function renderShell(tree: TreeResponse, isAnonymous = false) {
  return render(
    <SidebarProvider>
      <SidebarShell library={tree.library} tree={tree} isAnonymous={isAnonymous} />
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
  window.localStorage.clear();
});

describe("Sidebar", () => {
  it("renders 4 top-level group labels: Drive, Collections, Agent, Settings", () => {
    renderShell(baseTree());
    expect(screen.getByText("Drive")).toBeTruthy();
    expect(screen.getByText("Collections")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("Collections exposes 4 links with correct hrefs", () => {
    const { container } = renderShell(baseTree());
    const byHref = (h: string) =>
      container.querySelector(`a[href="${h}"]`) as HTMLAnchorElement | null;
    expect(byHref("/papers")?.textContent).toMatch(/papers/i);
    expect(byHref("/references")?.textContent).toMatch(/references/i);
    expect(byHref("/notes")?.textContent).toMatch(/notes/i);
    const papersetsLink = byHref("/papersets");
    expect(papersetsLink).toBeTruthy();
    expect(papersetsLink?.textContent).toMatch(/papersets/i);
  });

  it("renders Trash row at bottom of Drive with sidebar-trash testid", () => {
    renderShell(baseTree());
    // Drive is collapsed by default — expand it first
    fireEvent.click(screen.getByRole("button", { name: /drive/i }));
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
    // Drive is collapsed by default — expand it first
    fireEvent.click(screen.getByRole("button", { name: /drive/i }));
    expect(screen.queryByTestId("sidebar-trash-badge")).toBeTruthy();
  });

  it("hides badge dot when Trash is empty", () => {
    renderShell(baseTree());
    expect(screen.queryByTestId("sidebar-trash-badge")).toBeNull();
  });

  it("renders 'Sign up to save' CTA when isAnonymous=true", () => {
    renderShell(baseTree(), true);
    const cta = screen.getByTestId("sidebar-anon-signup-cta");
    expect(cta).toBeTruthy();
    expect(cta.textContent).toMatch(/sign up to save/i);
    expect(cta.getAttribute("href")).toBe("/sign-up");
  });

  it("does not render 'Sign up to save' CTA when isAnonymous=false", () => {
    renderShell(baseTree(), false);
    expect(screen.queryByTestId("sidebar-anon-signup-cta")).toBeNull();
  });
});
