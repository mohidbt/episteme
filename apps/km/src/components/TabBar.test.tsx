// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const push = vi.fn();
let mockPathname = "/";

const stableRouter = { push, refresh: () => {}, replace: () => {} };
vi.mock("next/navigation", () => ({
  useRouter: () => stableRouter,
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

  it("restores tabs from localStorage on remount (matching-pathname tab stays put)", async () => {
    // GSD-26: pathname sync now navigates the ACTIVE tab in place instead of
    // appending. If the stored active tab already matches the pathname, the
    // sibling tabs stay intact.
    mockPathname = "/n/persisted";
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
    expect(api!.tabs.find((t) => t.href === "/n/persisted")).toBeTruthy();
    expect(api!.tabs.find((t) => t.href === "/papers")).toBeTruthy();
    expect(api!.activeHref).toBe("/n/persisted");
  });

  it("first render returns SSR-safe defaults even when localStorage is populated, then hydrates from storage (GSD-79 URL trust)", async () => {
    // First commit = DEFAULT_STATE (SSR-safe). After mount the hydrate
    // effect reconciles activeHref to the actual URL: pathname=/ does NOT
    // match the stored /n/persisted tab, so we APPEND a fresh "/" tab and
    // activate it — the stored tab is preserved (GSD-79: URL trust without
    // clobbering sibling tabs).
    mockPathname = "/";
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
    expect(renders[0].tabs).toEqual([]);
    expect(renders[0].activeHref).toBeNull();
    const last = renders[renders.length - 1];
    const hrefs = last.tabs.map((t) => t.href);
    expect(hrefs).toContain("/n/persisted");
    expect(hrefs).toContain("/");
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

  it("isAnonymous first-paint seeds Drive+Welcome tabs but does NOT auto-push to welcome note (GSD-38)", async () => {
    // Bug: guest landing at "/" was being force-redirected to /n/welcome-to-episteme,
    // interrupting the joyride autostart. Seed the tabs so user can click Welcome,
    // but keep them on Drive so the tour fires at step 0.
    mockPathname = "/";
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    render(
      <TabBarProvider isAnonymous>
        <Probe />
      </TabBarProvider>,
    );
    expect(api!.tabs.map((t) => t.href)).toEqual([
      "/",
      "/n/welcome-to-episteme",
    ]);
    expect(api!.activeHref).toBe("/");
    expect(push).not.toHaveBeenCalled();
  });

  // ── GSD-26: Chrome tab navigation model ────────────────────────────────
  it("GSD-26: pathname change navigates active tab in place (does NOT add new tab)", async () => {
    // Start with two tabs, active=/n/foo at pathname=/n/foo. Simulate the user
    // clicking a link that pushes /n/bar — the active tab should update to
    // /n/bar in place. Sibling /papers tab is untouched.
    mockPathname = "/n/foo";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [
          { href: "/n/foo", title: "Foo" },
          { href: "/papers", title: "Papers" },
        ],
        activeHref: "/n/foo",
      }),
    );
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    const { rerender } = render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    expect(api!.tabs.map((t) => t.href)).toEqual(["/n/foo", "/papers"]);
    // Simulate router.push("/n/bar") — pathname changes, TabBar reacts.
    act(() => {
      mockPathname = "/n/bar";
      rerender(
        <TabBarProvider>
          <Probe />
        </TabBarProvider>,
      );
    });
    expect(api!.tabs.map((t) => t.href)).toEqual(["/n/bar", "/papers"]);
    expect(api!.activeHref).toBe("/n/bar");
  });

  it("GSD-26: openInNewTab adds a tab without changing the current active tab", async () => {
    mockPathname = "/n/foo";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [{ href: "/n/foo", title: "Foo" }],
        activeHref: "/n/foo",
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
    push.mockClear();
    act(() => {
      api!.openInNewTab("/n/bar", "Bar");
    });
    expect(api!.tabs.map((t) => t.href)).toEqual(["/n/foo", "/n/bar"]);
    // Background open: active stays on /n/foo, no router push.
    expect(api!.activeHref).toBe("/n/foo");
    expect(push).not.toHaveBeenCalled();
  });

  it("GSD-26: pathname change with no active tab seeds it (initial mount)", async () => {
    // No stored state, no isAnonymous seed — pathname useEffect must still
    // create the first tab. Regression guard: don't accidentally require an
    // active tab to exist.
    mockPathname = "/notes";
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
    expect(api!.tabs.map((t) => t.href)).toEqual(["/notes"]);
    expect(api!.activeHref).toBe("/notes");
  });

  it("GSD-26: pathname change matching an existing non-active tab activates it (no replace)", async () => {
    // User clicks an existing tab — pathname syncs to that tab's href. We
    // must NOT overwrite the previously-active tab's href.
    mockPathname = "/n/foo";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [
          { href: "/n/foo", title: "Foo" },
          { href: "/papers", title: "Papers" },
        ],
        activeHref: "/n/foo",
      }),
    );
    const { TabBarProvider, useTabs } = await import("./TabBar");
    let api: ReturnType<typeof useTabs> | null = null;
    function Probe() {
      api = useTabs();
      return null;
    }
    const { rerender } = render(
      <TabBarProvider>
        <Probe />
      </TabBarProvider>,
    );
    act(() => {
      mockPathname = "/papers";
      rerender(
        <TabBarProvider>
          <Probe />
        </TabBarProvider>,
      );
    });
    expect(api!.tabs.map((t) => t.href)).toEqual(["/n/foo", "/papers"]);
    expect(api!.activeHref).toBe("/papers");
  });

  it("GSD-79: hard-reload on a URL not in stored tabs appends a tab — never clobbers stored sibling", async () => {
    // E2E-B prod finding: user reloads /p/<paperId>, app-tabs-v1 has
    // activeHref=/n/x with /n/x in tabs. The mount-time pathname-sync was
    // replacing /n/x with /p/<paperId> in place, which destroyed the user's
    // open note tab. The fix: on hydrate, reconcile activeHref to the actual
    // URL by APPENDING a fresh tab for the URL if none of the stored tabs
    // match, instead of replacing the (unrelated) active tab.
    //
    // Acceptance:
    //   - /n/x stays in tabs (not clobbered).
    //   - /p/abc is appended and becomes active.
    //   - router.push is NEVER called (tab restore must not write the URL).
    mockPathname = "/p/abc";
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [{ href: "/n/x", title: "X" }],
        activeHref: "/n/x",
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
    const hrefs = api!.tabs.map((t) => t.href);
    expect(hrefs).toContain("/n/x");
    expect(hrefs).toContain("/p/abc");
    expect(api!.activeHref).toBe("/p/abc");
    expect(push).not.toHaveBeenCalled();
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
