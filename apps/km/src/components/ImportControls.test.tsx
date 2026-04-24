// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ImportControls } from "./ImportControls";
import type { FolderRow } from "@/lib/folders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const FOLDERS: FolderRow[] = [
  { id: "folder-aaa", parentId: null, name: "Research", isTrash: false },
  { id: "folder-bbb", parentId: "folder-aaa", name: "2024", isTrash: false },
];

function mockFetchImportOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ imported: 1, skipped: 0, conflicts: [] }), {
        status: 200,
      }),
    ),
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportControls folderId", () => {
  it("renders folder picker button defaulting to library root", async () => {
    render(<ImportControls libraryId={1} folders={FOLDERS} />);
    const btn = screen.getByRole("button", { name: /import into/i });
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/library root/i);
  });

  it("clicking folder picker opens MoveToDialog", async () => {
    render(<ImportControls libraryId={1} folders={FOLDERS} />);
    fireEvent.click(screen.getByRole("button", { name: /import into/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /move/i })).toBeTruthy(),
    );
  });

  it("selecting a folder from dialog updates button label and sends folderId on upload", async () => {
    mockFetchImportOk();
    render(<ImportControls libraryId={1} folders={FOLDERS} />);

    // Open folder picker
    fireEvent.click(screen.getByRole("button", { name: /import into/i }));
    await waitFor(() => screen.getByTestId("move-item-folder-aaa"));

    // Select Research folder
    fireEvent.click(screen.getByTestId("move-item-folder-aaa"));
    fireEvent.click(screen.getByTestId("move-confirm"));

    // Dialog should close, button label updated
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /import into/i });
      expect(btn.textContent).toMatch(/research/i);
    });

    // Choose a file and upload
    const fileInput = document.querySelector("input[type=file]") as HTMLInputElement;
    selectFile(fileInput, new File(["# hi"], "notes.md", { type: "text/markdown" }));
    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));

    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled());

    const fetchMock = vi.mocked(globalThis.fetch);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const body = call![1]?.body as FormData;
    expect(body.get("folderId")).toBe("folder-aaa");
  });

  it("no folderId field when library root is selected (default)", async () => {
    mockFetchImportOk();
    render(<ImportControls libraryId={1} folders={FOLDERS} />);

    const fileInput = document.querySelector("input[type=file]") as HTMLInputElement;
    selectFile(fileInput, new File(["# hi"], "notes.md", { type: "text/markdown" }));
    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));

    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled());

    const fetchMock = vi.mocked(globalThis.fetch);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const body = call![1]?.body as FormData;
    // folderId should be absent when target is library root
    expect(body.get("folderId")).toBeNull();
  });
});
