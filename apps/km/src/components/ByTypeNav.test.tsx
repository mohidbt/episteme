// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ByTypeNav } from "./ByTypeNav";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock("@/lib/drive-sync", () => ({ invalidateDriveTree: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
});

afterEach(() => cleanup());

function renderNav(...args: [] | [number | undefined]) {
  const libraryId = args.length === 0 ? 1 : args[0];
  return render(
    <SidebarProvider>
      {libraryId === undefined ? <ByTypeNav /> : <ByTypeNav libraryId={libraryId} />}
    </SidebarProvider>,
  );
}

describe("ByTypeNav", () => {
  beforeEach(() => {
    push.mockReset();
    (globalThis as { fetch?: unknown }).fetch = vi.fn();
  });

  it("renders Papersets entry with /papersets href", () => {
    renderNav();
    const link = screen.getByRole("link", { name: /papersets/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/papersets");
    expect(link.querySelector("svg")).toBeTruthy();
  });

  it("renders Papers, References, Notes, Papersets links", () => {
    const { container } = renderNav();
    const byHref = (h: string) =>
      container.querySelector(`a[href="${h}"]`) as HTMLAnchorElement | null;
    expect(byHref("/papers")).toBeTruthy();
    expect(byHref("/references")).toBeTruthy();
    expect(byHref("/notes")).toBeTruthy();
    expect(byHref("/papersets")).toBeTruthy();
  });

  it("renders a quick-create + button for Notes, References, Papersets only", () => {
    renderNav();
    expect(screen.getByLabelText("Quick create note")).toBeTruthy();
    expect(screen.getByLabelText("Quick create reference")).toBeTruthy();
    expect(screen.getByLabelText("Quick create paperset")).toBeTruthy();
    expect(screen.queryByLabelText("Quick create paper")).toBeNull();
    expect(screen.queryByLabelText("Quick create graph")).toBeNull();
  });

  it("clicking + on Notes POSTs /api/notes and navigates to /n/<slug>", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "note-123", slug: "untitled" }),
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    renderNav(7);
    fireEvent.click(screen.getByLabelText("Quick create note"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/notes");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.libraryId).toBe(7);
    expect(body.folderId).toBeNull();
    expect(typeof body.title).toBe("string");
    expect(body.title.length).toBeGreaterThan(0);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/n/untitled"));
  });

  it("clicking + on References POSTs /api/references with a citationKey and navigates to /r/<id>", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "ref-xyz" }),
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    renderNav(7);
    fireEvent.click(screen.getByLabelText("Quick create reference"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/references");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.libraryId).toBe(7);
    expect(body.folderId).toBeNull();
    expect(typeof body.citationKey).toBe("string");
    expect(body.citationKey).toMatch(/^[A-Za-z0-9_:-]+$/);
    expect(body.cslJson).toBeDefined();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/r/ref-xyz"));
  });

  it("clicking + on Papersets POSTs /api/papersets with default column and navigates to /d/<id>", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "ps-abc" }),
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    renderNav(7);
    fireEvent.click(screen.getByLabelText("Quick create paperset"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/papersets");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(typeof body.filename).toBe("string");
    expect(body.filename.length).toBeGreaterThan(0);
    expect(Array.isArray(body.columns)).toBe(true);
    expect(body.columns.length).toBeGreaterThanOrEqual(1);
    expect(body.columns[0].name).toBeTruthy();
    expect(body.columns[0].description).toBeTruthy();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/d/ps-abc"));
  });

  it("hides quick-create buttons when libraryId is undefined", () => {
    renderNav(undefined);
    expect(screen.queryByLabelText("Quick create note")).toBeNull();
    expect(screen.queryByLabelText("Quick create reference")).toBeNull();
    expect(screen.queryByLabelText("Quick create paperset")).toBeNull();
  });
});
