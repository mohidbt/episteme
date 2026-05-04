// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const push = vi.fn();
let mockPathname = "/";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: () => {}, replace: () => {} }),
  usePathname: () => mockPathname,
}));

const STORAGE_KEY = "app-tabs-v1";

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
  mockPathname = "/";
});

afterEach(() => {
  cleanup();
});

describe("useTabs hook", () => {
  it("openTab adds entry to state and persists to localStorage", async () => {
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    act(() => {
      api!.openTab("/n/foo", "Foo");
    });
    expect(api!.tabs.find((t) => t.href === "/n/foo")).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    expect(stored.tabs.some((t: { href: string }) => t.href === "/n/foo")).toBe(true);
  });

  it("closeTab removes entry from state", async () => {
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    act(() => {
      api!.openTab("/n/foo", "Foo");
      api!.openTab("/n/bar", "Bar");
    });
    act(() => {
      api!.closeTab("/n/foo");
    });
    expect(api!.tabs.find((t) => t.href === "/n/foo")).toBeUndefined();
    expect(api!.tabs.find((t) => t.href === "/n/bar")).toBeTruthy();
  });

  it("setActive triggers router.push", async () => {
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    act(() => {
      api!.openTab("/n/foo", "Foo");
    });
    push.mockClear();
    act(() => {
      api!.setActive("/n/foo");
    });
    expect(push).toHaveBeenCalledWith("/n/foo");
  });

  it("restores tabs from localStorage on remount", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [
          { href: "/n/persisted", title: "Persisted" },
          { href: "/papers", title: "Papers" },
        ],
        activeHref: "/n/persisted",
      }),
    );
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    // Stored tabs are restored; pathname-sync also adds a tab for "/"
    expect(api!.tabs.find((t) => t.href === "/n/persisted")).toBeTruthy();
    expect(api!.tabs.find((t) => t.href === "/papers")).toBeTruthy();
  });

  it("first render returns SSR-safe defaults even when localStorage is populated, then hydrates from storage", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [{ href: "/n/persisted", title: "Persisted" }],
        activeHref: "/n/persisted",
      }),
    );
    const { TabBarProvider, useTabs } = await import("./TabBar");
    const renders: { tabs: { href: string }[]; activeHref: string | null }[] =
      [];
    function Probe() {
      const api = useTabs();
      // Capture every render's snapshot during render phase (before effects).
      renders.push({
        tabs: api.tabs.map((t) => ({ href: t.href })),
        activeHref: api.activeHref,
      });
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    // First render must equal what SSR would produce: empty default state.
    expect(renders[0].tabs).toEqual([]);
    expect(renders[0].activeHref).toBeNull();
    // After effects flush, stored tabs are restored AND pathname-sync
    // adds a tab for the current path ("/"), making it active.
    const last = renders[renders.length - 1];
    expect(last.tabs.some((t) => t.href === "/n/persisted")).toBe(true);
    expect(last.activeHref).toBe("/");
  });

  it("closeTab on the active tab navigates to the next tab via router.push", async () => {
    // Regression test: router.push used to be called inside the setState
    // updater, which fires during render and triggered the React warning.
    // Now it fires after setState — verify it still happens.
    mockPathname = "/n/bar";
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    act(() => {
      api!.openTab("/n/foo", "Foo");
      api!.openTab("/n/bar", "Bar");
    });
    push.mockClear();
    act(() => {
      api!.closeTab("/n/bar");
    });
    // closeTab on the active tab pushes to the next remaining tab.
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("openTab on existing href does not duplicate, just activates", async () => {
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    act(() => {
      api!.openTab("/n/foo", "Foo");
      api!.openTab("/n/foo", "Foo");
    });
    expect(api!.tabs.filter((t) => t.href === "/n/foo")).toHaveLength(1);
  });

  it("updateTabTitle replaces inferred detail labels with loaded titles", async () => {
    mockPathname = "/p/paper-1";
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    expect(api!.tabs.find((t) => t.href === "/p/paper-1")?.title).toBe("Paper");
    act(() => {
      api!.updateTabTitle("/p/paper-1", "Attention Is All You Need");
    });
    expect(api!.tabs.find((t) => t.href === "/p/paper-1")?.title).toBe(
      "Attention Is All You Need",
    );
  });

  it("infers '/papers/:id/read' tabs as Reader before title hydration", async () => {
    mockPathname = "/papers/p-123/read";
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    expect(api!.tabs.find((t) => t.href === "/papers/p-123/read")?.title).toBe("Reader");
  });

  it("reorderTabs moves tabs in local state", async () => {
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    act(() => {
      api!.openTab("/n/one", "One");
      api!.openTab("/n/two", "Two");
      api!.openTab("/n/three", "Three");
    });
    act(() => {
      api!.reorderTabs("/n/three", "/n/one");
    });
    expect(api!.tabs.map((tab) => tab.href)).toEqual([
      "/",
      "/n/three",
      "/n/one",
      "/n/two",
    ]);
  });
});

describe("TabBar component", () => {
  it("renders open tabs and a + button", async () => {
    const { TabBarProvider, TabBar } = await import("./TabBar");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [{ href: "/", title: "Drive" }],
        activeHref: "/",
      }),
    );
    const { container, getByText } = render(
      <TabBarProvider>
        <TabBar />
      </TabBarProvider>,
    );
    expect(getByText("Drive")).toBeTruthy();
    expect(container.querySelector('[data-testid="tab-bar-new"]')).toBeTruthy();
  });

  it("exposes --tabbar-h CSS var on the root tablist (consumed by AgentBall panel bounds)", async () => {
    const { TabBarProvider, TabBar } = await import("./TabBar");
    const { container } = render(
      <TabBarProvider>
        <TabBar />
      </TabBarProvider>,
    );
    const root = container.querySelector('[data-testid="tab-bar"]') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.getPropertyValue("--tabbar-h")).toBe("52px");
  });
});
