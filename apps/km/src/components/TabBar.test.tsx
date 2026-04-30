// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const push = vi.fn();
let mockPathname = "/drive";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: () => {}, replace: () => {} }),
  usePathname: () => mockPathname,
}));

const STORAGE_KEY = "app-tabs-v1";

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
  mockPathname = "/drive";
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
    expect(api!.tabs).toHaveLength(2);
    expect(api!.tabs[0].href).toBe("/n/persisted");
    expect(api!.tabs[1].href).toBe("/papers");
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
});

describe("TabBar component", () => {
  it("renders open tabs and a + button", async () => {
    const { TabBarProvider, TabBar } = await import("./TabBar");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [{ href: "/drive", title: "Drive" }],
        activeHref: "/drive",
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
});
