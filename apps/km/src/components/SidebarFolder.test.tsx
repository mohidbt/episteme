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
import { SidebarFolder } from "./SidebarFolder";
import type { FolderNode } from "@/lib/tree";

type FetchImpl = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(impl: FetchImpl) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const FOLDER_ID = "11111111-1111-1111-1111-111111111111";

function makeNode(): FolderNode {
  return {
    folder: { id: FOLDER_ID, name: "Alpha", isTrash: false },
    path: "Alpha/",
    items: [],
    children: [],
  };
}

function renderFolder(node: FolderNode = makeNode()) {
  return render(
    <SidebarProvider>
      <SidebarMenu>
        <SidebarFolder
          node={node}
          section="notes"
          depth={1}
          libraryId={1}
          allFolders={[
            { id: FOLDER_ID, parentId: null, name: "Alpha", isTrash: false },
          ]}
          onMutate={() => {}}
        />
      </SidebarMenu>
    </SidebarProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  // jsdom doesn't ship matchMedia; use-mobile hook needs it.
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
  // Ensure localStorage is a functioning Storage-like object.
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
  vi.restoreAllMocks();
});

describe("SidebarFolder", () => {
  it("renders folder name and chevron", () => {
    renderFolder();
    expect(screen.getByText("Alpha")).toBeTruthy();
    // Collapsed by default.
    const btn = screen.getByRole("button", { name: "Alpha" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("click toggles expansion (aria-expanded)", () => {
    renderFolder();
    const btn = screen.getByRole("button", { name: "Alpha" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("right-click opens context menu with Rename / Move to… / Move to Trash", async () => {
    renderFolder();
    const btn = screen.getByRole("button", { name: "Alpha" });
    fireEvent.contextMenu(btn);
    await waitFor(() => {
      expect(screen.getByText(/rename folder/i)).toBeTruthy();
    });
    // "Move to…" (ellipsis) vs "Move to Trash" — both exist; two matches.
    expect(screen.getAllByText(/^move to/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/move to trash/i)).toBeTruthy();
  });

  it("Rename flow: PATCH /api/folders/:id { name }", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === `/api/folders/${FOLDER_ID}` && init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      return new Response("nope", { status: 404 });
    });
    renderFolder();
    const btn = screen.getByRole("button", { name: "Alpha" });
    fireEvent.contextMenu(btn);
    await waitFor(() => screen.getByText(/rename folder/i));
    fireEvent.click(screen.getByText(/rename folder/i));

    const input = await waitFor(() =>
      screen.getByLabelText(/folder name/i) as HTMLInputElement,
    );
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (c) => c[0] === `/api/folders/${FOLDER_ID}` && (c[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall![1] as RequestInit).body));
      expect(body).toEqual({ name: "X" });
    });
  });

  it("Move to Trash: POST /api/folders/trash { libraryId, target: { kind, id } }", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url === "/api/folders/trash" && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      return new Response("nope", { status: 404 });
    });
    renderFolder();
    const btn = screen.getByRole("button", { name: "Alpha" });
    fireEvent.contextMenu(btn);
    await waitFor(() => screen.getByText(/move to trash/i));
    fireEvent.click(screen.getByText(/move to trash/i));

    // Confirm dialog → click Delete
    const confirm = await waitFor(() =>
      screen.getByRole("button", { name: /^(delete|move to trash)$/i }),
    );
    fireEvent.click(confirm);

    await waitFor(() => {
      const trashCall = fetchMock.mock.calls.find(
        (c) => c[0] === "/api/folders/trash" && (c[1] as RequestInit)?.method === "POST",
      );
      expect(trashCall).toBeDefined();
      const body = JSON.parse(String((trashCall![1] as RequestInit).body));
      expect(body).toEqual({
        libraryId: 1,
        target: { kind: "folder", id: FOLDER_ID },
      });
    });
  });
});
