// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, act } from "@testing-library/react";
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
    papersets: [],
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
    expect(screen.queryByText(/co-scientist/i)).toBeNull();
  });

  it("renames the agent settings link to 'Agent Settings'", () => {
    const { container } = renderShell(baseTree());
    const link = container.querySelector(
      'a[href="/settings/agents"]',
    ) as HTMLAnchorElement | null;
    expect(link?.textContent).toMatch(/agent settings/i);
    expect(link?.textContent).not.toMatch(/permissions/i);
    expect(link?.textContent).not.toMatch(/mcp/i);
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

  describe("collapsible behavior", () => {
    function getRail() {
      return document.querySelector(
        "[data-testid='sidebar-rail-root']",
      ) as HTMLElement | null;
    }

    it("renders expanded by default (no collapsed state stored)", () => {
      renderShell(baseTree());
      const rail = getRail();
      expect(rail).toBeTruthy();
      expect(rail?.getAttribute("data-collapsed")).toBe("false");
    });

    it("collapse button click toggles to collapsed state", () => {
      renderShell(baseTree());
      const toggle = screen.getByTestId("sidebar-collapse-toggle");
      fireEvent.click(toggle);
      expect(getRail()?.getAttribute("data-collapsed")).toBe("true");
    });

    it("hover on collapsed rail expands (peek)", () => {
      renderShell(baseTree());
      fireEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
      const rail = getRail()!;
      expect(rail.getAttribute("data-collapsed")).toBe("true");
      expect(rail.getAttribute("data-peeking")).toBe("false");
      fireEvent.mouseEnter(rail);
      expect(rail.getAttribute("data-peeking")).toBe("true");
    });

    it("mouseleave reverts peek to collapsed", () => {
      vi.useFakeTimers();
      try {
        renderShell(baseTree());
        fireEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
        const rail = getRail()!;
        fireEvent.mouseEnter(rail);
        expect(rail.getAttribute("data-peeking")).toBe("true");
        fireEvent.mouseLeave(rail);
        act(() => {
          vi.advanceTimersByTime(500);
        });
        expect(rail.getAttribute("data-peeking")).toBe("false");
      } finally {
        vi.useRealTimers();
      }
    });

    it("persists collapsed state across remount via localStorage", () => {
      const { unmount } = renderShell(baseTree());
      fireEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
      expect(window.localStorage.getItem("sidebar-collapsed")).toBe("true");
      unmount();
      renderShell(baseTree());
      expect(getRail()?.getAttribute("data-collapsed")).toBe("true");
    });
  });
});
