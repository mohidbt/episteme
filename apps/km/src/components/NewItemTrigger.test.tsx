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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
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
  it("opens menu with 4 items (Note, Reference, Paperset, Folder)", async () => {
    renderTrigger();
    const trigger = screen.getByRole("button", { name: /new/i });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText(/^note$/i)).toBeTruthy();
    });
    expect(screen.getByText(/^reference$/i)).toBeTruthy();
    // "Upload paper" was replaced by "Paperset" when papersets were added.
    expect(screen.getByText(/^paperset$/i)).toBeTruthy();
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

  it("note-create on 403 guest_forbidden shows guest toast, not generic", async () => {
    mockFetch((url, init) => {
      if (url === "/api/notes" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "guest_forbidden" }), {
          status: 403,
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

    const errorMock = toast.error as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(errorMock).toHaveBeenCalled();
    });
    const messages = errorMock.mock.calls.map((c) => String(c[0]).toLowerCase());
    expect(messages.some((m) => m.includes("guest mode"))).toBe(true);
    expect(messages.some((m) => m.includes("create failed"))).toBe(false);
  });

  it("dropdown menu includes a Paperset option", async () => {
    renderTrigger();
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    await waitFor(() => screen.getByText(/^paperset$/i));
    expect(screen.getByText(/^paperset$/i)).toBeTruthy();
  });

  it("toolbar variant opens menu on click (GSD-83 regression)", async () => {
    render(
      <NewItemTrigger
        libraryId={1}
        folderId={null}
        variant="toolbar"
        onMutate={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: /new/i });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText(/^note$/i)).toBeTruthy();
    });
    expect(screen.getByText(/^folder$/i)).toBeTruthy();
    expect(screen.getByText(/^paperset$/i)).toBeTruthy();
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
