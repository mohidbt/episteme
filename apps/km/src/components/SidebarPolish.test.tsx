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

// ── #123: Collapsed sidebar section gaps ──────────────────────────────────

describe("#123: Collapsed sidebar section gaps", () => {
  it("sidebar groups have increased vertical gap between sections", () => {
    renderShell(baseTree());
    const groups = document.querySelectorAll("[data-sidebar='group']");
    // At minimum, Drive, Collections, Agent, Settings = 4 groups
    expect(groups.length).toBeGreaterThanOrEqual(3);
    // Each group after the first should have a top margin class
    // (gap is applied via mt-4 or similar on all but first group)
    for (let i = 0; i < groups.length; i++) {
      const cls = groups[i].className;
      if (i === 0) {
        // First group should NOT have the section-gap class
        expect(cls).not.toContain("ep-sb-section-gap");
      } else {
        // Subsequent groups should have section-gap class
        expect(cls).toContain("ep-sb-section-gap");
      }
    }
  });
});

// ── #124: Logo same size collapsed/expanded ───────────────────────────────

describe("#124: Logo same size in collapsed and expanded sidebar", () => {
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

// ── #127: Bigger font size for sidebar section titles ──────────────────────

describe("#127: Sidebar section title font size", () => {
  it("section titles use 14px font (not 13px)", () => {
    renderShell(baseTree());
    // All section toggle buttons should have text-[14px]
    const toggles = document.querySelectorAll(".sidebar-section-toggle");
    for (const toggle of Array.from(toggles)) {
      expect(toggle.className).toContain("text-[14px]");
    }
  });
});

// ── #132: Drive title uses SidebarSection component ───────────────────────

describe("#132: Drive title uses SidebarSection", () => {
  it("Drive section renders via SidebarSection component (has sidebar-section-toggle class)", () => {
    renderShell(baseTree());
    // Drive should use the same toggle class as other sections
    const driveToggle = screen.getByRole("button", { name: /drive/i });
    expect(driveToggle.className).toContain("sidebar-section-toggle");
  });

  it("Drive title has same font size as Collections title", () => {
    renderShell(baseTree());
    const driveToggle = screen.getByRole("button", { name: /drive/i });
    const collectionsToggle = screen.getByRole("button", { name: /collections/i });
    // Extract font-size class
    const driveFontSize = driveToggle.className.match(/text-\[\d+px\]/)?.[0];
    const collectionsFontSize = collectionsToggle.className.match(/text-\[\d+px\]/)?.[0];
    expect(driveFontSize).toBe(collectionsFontSize);
  });
});

// ── #133: Drive items font size matches other sections ────────────────────

describe("#133: Drive items font size matches other sections", () => {
  it("Drive leaf items use same font size as other section items", () => {
    const tree = baseTree({
      papers: [
        { id: "p1", title: "Test Paper", folderId: null },
      ],
    });
    renderShell(tree);
    // Expand the Drive section
    fireEvent.click(screen.getByRole("button", { name: /drive/i }));

    // Get a drive leaf item and a collections item
    const paperLink = screen.getByRole("link", { name: /test paper/i });
    const papersLink = screen.getByRole("link", { name: /papers/i });

    // Both should use text-[13px]
    expect(paperLink.className).toContain("text-[13px]");
    expect(papersLink.className).toContain("text-[13px]");
  });
});

// ── #140: Agent section uses ⬡ symbol ────────────────────────────────────

describe("#140: Agent section uses hexagon symbol", () => {
  it("Agent section icon is the ⬡ character, not Bot SVG", () => {
    const { container } = renderShell(baseTree());
    // Find the agent section toggle
    const agentToggle = screen.getByRole("button", { name: /agent/i });
    expect(agentToggle).toBeTruthy();
    // The icon should contain ⬡ text, not an SVG icon
    const svgInAgent = agentToggle.querySelector("svg");
    expect(svgInAgent).toBeNull();
    // Should contain the hexagon character
    expect(agentToggle.textContent).toContain("⬡");
  });
});