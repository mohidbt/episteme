// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { SidebarProvider, SidebarMenu } from "@/components/ui/sidebar";
import { NewItemTrigger } from "./NewItemTrigger";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const FOLDER_ID = "22222222-2222-2222-2222-222222222222";

function renderTrigger(folderId: string | null = FOLDER_ID) {
  return render(
    <SidebarProvider>
      <SidebarMenu>
        <NewItemTrigger
          libraryId={1}
          folderId={folderId}
          onMutate={() => {}}
          variant="menu-item"
        />
      </SidebarMenu>
    </SidebarProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NewItemTrigger", () => {
  it("opens menu with 4 items (Note, Reference, Upload paper, Folder)", async () => {
    renderTrigger();
    const trigger = screen.getByRole("button", { name: /new/i });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText(/^note$/i)).toBeTruthy();
    });
    expect(screen.getByText(/^reference$/i)).toBeTruthy();
    expect(screen.getByText(/upload paper/i)).toBeTruthy();
    expect(screen.getByText(/^folder$/i)).toBeTruthy();
  });

  it("clicking Note opens title dialog; submit POSTs /api/notes with folderId", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/notes" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "n1", slug: "x" }), {
          status: 201,
        });
      }
      return new Response("nope", { status: 404 });
    });
    renderTrigger();
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    await waitFor(() => screen.getByText(/^note$/i));
    fireEvent.click(screen.getByText(/^note$/i));

    const input = await waitFor(
      () => screen.getByLabelText(/title/i) as HTMLInputElement,
    );
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/notes" && (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call![1] as RequestInit).body));
      expect(body.folderId).toBe(FOLDER_ID);
      expect(body.libraryId).toBe(1);
      expect(body.title).toBe("Hello");
    });
  });

  it("clicking Folder opens name dialog; submit POSTs /api/folders with parentId=folderId", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/folders" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "f1" }), { status: 201 });
      }
      return new Response("nope", { status: 404 });
    });
    renderTrigger();
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    await waitFor(() => screen.getByText(/^folder$/i));
    fireEvent.click(screen.getByText(/^folder$/i));

    const input = await waitFor(
      () => screen.getByLabelText(/folder name/i) as HTMLInputElement,
    );
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/folders" && (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call![1] as RequestInit).body));
      expect(body).toEqual({ libraryId: 1, parentId: FOLDER_ID, name: "X" });
    });
  });
});
