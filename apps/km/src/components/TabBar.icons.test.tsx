// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";

let mockPathname = "/";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: () => {}, replace: () => {} }),
  usePathname: () => mockPathname,
}));

const STORAGE_KEY = "app-tabs-v1";

beforeEach(() => {
  window.localStorage.clear();
  mockPathname = "/";
});

afterEach(() => {
  cleanup();
});

// Lazy-import after mocks are set up.
async function loadTabs() {
  return await import("./TabBar");
}

function seed(tabs: Array<{ href: string; title: string }>, activeHref: string) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ tabs, activeHref }),
  );
}

describe("TabBar — file-type icons (B14)", () => {
  it("renders the FileText icon for a paper tab", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/p/abc", title: "My Paper" },
      ],
      "/p/abc",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.getByTestId("tab-icon-paper")).toBeTruthy();
  });

  it("renders the StickyNote icon for a note tab", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/n/hello", title: "Hello Note" },
      ],
      "/n/hello",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.getByTestId("tab-icon-note")).toBeTruthy();
  });

  it("renders the BookMarked icon for a reference tab", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/r/abc", title: "Ref" },
      ],
      "/r/abc",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.getByTestId("tab-icon-reference")).toBeTruthy();
  });

  it("renders no file-type icon for the Drive root tab", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed([{ href: "/", title: "Drive" }], "/");
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.queryByTestId("tab-icon-paper")).toBeNull();
    expect(screen.queryByTestId("tab-icon-note")).toBeNull();
    expect(screen.queryByTestId("tab-icon-reference")).toBeNull();
  });
});
