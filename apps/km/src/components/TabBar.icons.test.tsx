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

  it("renders the Table2 icon for a paperset list tab (/papersets)", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/papersets", title: "Papersets" },
      ],
      "/papersets",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.getByTestId("tab-icon-paperset")).toBeTruthy();
  });

  it("renders the Table2 icon for a paperset detail tab (/d/<id>)", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/d/ps1", title: "My Paperset" },
      ],
      "/d/ps1",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.getByTestId("tab-icon-paperset")).toBeTruthy();
  });

  it("renders the Hexagon icon for an agent tab (/agents)", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/agents", title: "Agent" },
      ],
      "/agents",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.getByTestId("tab-icon-agent")).toBeTruthy();
  });
});

describe("TabBar — label truncation (K5a)", () => {
  it("strips .md suffix from note tab labels", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/n/hello", title: "My Great Note.md" },
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
    // The visible label should NOT contain ".md"
    expect(screen.queryByText("My Great Note.md")).toBeNull();
    expect(screen.getByText("My Great Note")).toBeTruthy();
  });

  it("strips .markdown suffix from note tab labels", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/n/x", title: "Doc.markdown" },
      ],
      "/n/x",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    expect(screen.getByText("Doc")).toBeTruthy();
  });

  it("caps very long titles at 30 chars with ellipsis", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    const longTitle = "This Is An Extremely Long Title That Exceeds Thirty Characters For Sure";
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/p/abc", title: longTitle },
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
    // Visible text should be capped at 30 chars + ellipsis
    const visible = screen.getByText((content) => content.startsWith("This Is An") && content.endsWith("…"));
    expect(visible).toBeTruthy();
    expect(visible.textContent!.length).toBeLessThanOrEqual(31);
  });

  it("sets browser tooltip (title attr) to the full original name", async () => {
    const { TabBarProvider, TabBar } = await loadTabs();
    seed(
      [
        { href: "/", title: "Drive" },
        { href: "/n/x", title: "Full Original Name.md" },
      ],
      "/n/x",
    );
    await act(async () => {
      render(
        <TabBarProvider>
          <TabBar />
        </TabBarProvider>,
      );
    });
    // The tab row should have a title attr equal to the full name
    const tabs = screen.getAllByTestId("tab-bar-tab");
    const noteTab = tabs.find((el) => el.getAttribute("data-href") === "/n/x");
    expect(noteTab).toBeTruthy();
    expect(noteTab!.getAttribute("title")).toBe("Full Original Name.md");
  });
});
