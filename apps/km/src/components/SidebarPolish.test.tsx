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

// ── #157: Sidebar section gaps ────────────────────────────────────────────

describe("#157: Sidebar section gaps", () => {
  it("uses one content gap and zero-padding groups for section spacing", () => {
    renderShell(baseTree());
    const content = document.querySelector("[data-sidebar='content']");
    expect(content?.className).toContain("gap-2");
    expect(content?.className).toContain("px-2");

    const groups = document.querySelectorAll("[data-sidebar='group']");
    expect(groups.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < groups.length; i += 1) {
      const cls = groups[i].className;
      expect(cls).toContain("px-0");
      expect(cls).toContain("py-0");
    }
  });
});

// ── #158: Logo same size collapsed/expanded ───────────────────────────────

describe("#158: Logo same size in collapsed and expanded sidebar", () => {
  it("collapsed logo character has same font-size as expanded", () => {
    const { container } = renderShell(baseTree());
    // The ε character should be present in both states
    const epsilonChars = container.querySelectorAll(".font-display");
    expect(epsilonChars.length).toBeGreaterThanOrEqual(1);
    // Both should use text-[17px] (or equivalent)
    for (const el of Array.from(epsilonChars)) {
      expect(el.className).toContain("text-[17px]");
    }
  });

  it("header has top padding to push content away from edge", () => {
    const { container } = renderShell(baseTree());
    const header = container.querySelector("[data-sidebar='header']");
    expect(header).toBeTruthy();
    // Header should have adequate top padding (pt-4 or more)
    expect(header?.className).toMatch(/pt-[4-9]/);
  });
});

// ── #159: Bigger font size for sidebar section titles ──────────────────────

describe("#159: Sidebar section title font size", () => {
  it("section titles use text-sm font sizing", () => {
    renderShell(baseTree());
    const toggles = document.querySelectorAll(".sidebar-section-toggle");
    for (const toggle of Array.from(toggles)) {
      expect(toggle.className).toContain("text-sm");
      expect(toggle.className).not.toContain("text-[13px]");
    }
  });
});

// ── #161: Drive title styling matches other sections ──────────────────────

describe("#161: Drive title styling", () => {
  it("Drive section uses the same toggle class as other sections", () => {
    renderShell(baseTree());
    const driveToggle = screen.getByRole("button", { name: /drive/i });
    expect(driveToggle.className).toContain("sidebar-section-toggle");
  });

  it("Drive title has same font size as Collections title", () => {
    renderShell(baseTree());
    const driveToggle = screen.getByRole("button", { name: /drive/i });
    const collectionsToggle = screen.getByRole("button", { name: /collections/i });
    expect(driveToggle.className).toContain("text-sm");
    expect(collectionsToggle.className).toContain("text-sm");
  });
});

// ── #162: Drive items font size ────────────────────────────────────────────

describe("#162: Drive items font size", () => {
  it("Drive leaf items match peer sidebar list item sizing", () => {
    const tree = baseTree({
      papers: [
        { id: "p1", title: "Test Paper", folderId: null },
      ],
    });
    renderShell(tree);
    // Expand the Drive section
    fireEvent.click(screen.getByRole("button", { name: /drive/i }));

    const paperButton = screen.getByRole("button", { name: /test paper/i });
    expect(paperButton.className).toContain("text-[13px]");
  });
});

// ── #154/#156: Collapsed sidebar details ─────────────────────────────────

describe("#154/#156: Collapsed sidebar details", () => {
  it("does not render an OpenRouter model label in the Agent section", () => {
    renderShell(baseTree());
    expect(screen.queryByText(/openrouter/i)).toBeNull();
    expect(screen.queryByText(/gemma/i)).toBeNull();
  });

  it("collapsed sidebar keeps Drive and Convos icons visible", () => {
    const { container } = renderShell(baseTree());
    fireEvent.click(screen.getByTestId("sidebar-collapse-toggle"));

    const drive = screen.getByRole("link", { name: /drive/i });
    const convos = container.querySelector('a[href="/agents"]');
    expect(drive.querySelector("svg")).toBeTruthy();
    expect(convos?.querySelector("svg")).toBeTruthy();
  });
});
