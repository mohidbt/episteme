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

// Replace FolderDestinationPicker with a stub that exposes buttons for each
// folder so we can drive `onChange` deterministically without dealing with the
// base-ui menu portal in jsdom. The real picker has its own contract; the
// integration we care about here is "ImportControls wires onChange into the
// import payload".
vi.mock("./FolderDestinationPicker", () => ({
  FolderDestinationPicker: ({
    folders,
    value,
    onChange,
    triggerTestId,
  }: {
    folders: FolderRow[];
    value: string | null;
    onChange: (id: string | null) => void;
    triggerTestId?: string;
  }) => (
    <div data-testid={triggerTestId ?? "folder-destination-picker"}>
      <span data-testid="picker-value">{value ?? "__root__"}</span>
      <button type="button" onClick={() => onChange(null)}>
        select-root
      </button>
      {folders.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
        >
          select-{f.id}
        </button>
      ))}
    </div>
  ),
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

describe("ImportControls folder picker", () => {
  it("renders the FolderDestinationPicker with library root selected by default", () => {
    render(<ImportControls libraryId={1} folders={FOLDERS} />);
    expect(screen.getByTestId("import-folder-picker")).toBeTruthy();
    expect(screen.getByTestId("picker-value").textContent).toBe("__root__");
  });

  it("selecting a folder updates the picker value and sends folderId on upload", async () => {
    mockFetchImportOk();
    render(<ImportControls libraryId={1} folders={FOLDERS} />);

    fireEvent.click(screen.getByText("select-folder-aaa"));

    expect(screen.getByTestId("picker-value").textContent).toBe("folder-aaa");

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

  it("does not send folderId when library root is selected (default)", async () => {
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
    expect(body.get("folderId")).toBeNull();
  });
});

describe("ImportControls layout order (#141)", () => {
  it("renders Choose file before the folder picker", () => {
    render(<ImportControls libraryId={1} folders={FOLDERS} />);
    const chooseBtn = screen.getByRole("button", { name: /choose file/i });
    const picker = screen.getByTestId("import-folder-picker");
    // Choose-file button should come before the folder picker in DOM order
    expect(chooseBtn.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the folder picker before the Upload button", () => {
    render(<ImportControls libraryId={1} folders={FOLDERS} />);
    const picker = screen.getByTestId("import-folder-picker");
    const uploadBtn = screen.getByRole("button", { name: /^upload$/i });
    // Picker should come before Upload button in DOM order
    expect(picker.compareDocumentPosition(uploadBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not render an 'Import into' text label", () => {
    render(<ImportControls libraryId={1} folders={FOLDERS} />);
    expect(screen.queryByText("Import into")).toBeNull();
  });
});
