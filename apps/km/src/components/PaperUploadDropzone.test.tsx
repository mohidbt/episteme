// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { PaperUploadDropzone } from "./PaperUploadDropzone";

// --- mock next/navigation ---
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Capture FormData bodies sent via fetch
let capturedBody: FormData | null = null;

function mockFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/papers" && (init?.method ?? "GET") === "POST") {
        capturedBody = init?.body as FormData;
        return new Response(
          JSON.stringify({ paperId: "paper-1", uploadUrl: "" }),
          { status: 201 },
        );
      }
      // finalize endpoint
      if (url.startsWith("/api/papers/") && url.endsWith("/finalize")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

beforeEach(() => {
  capturedBody = null;
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

function dropFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", {
    value: [file],
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("PaperUploadDropzone folderId", () => {
  it("includes folderId in POST body when folderId prop is set", async () => {
    mockFetchOk();
    render(
      <PaperUploadDropzone
        libraryId={1}
        folderPath=""
        folderId="abc-uuid-1111"
      />,
    );
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["pdf"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const paperCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/papers" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(paperCall).toBeDefined();
    const body = JSON.parse(String((paperCall![1] as RequestInit).body));
    expect(body.folderId).toBe("abc-uuid-1111");
  });

  it("does NOT include folderId in POST body when folderId prop is null", async () => {
    mockFetchOk();
    render(
      <PaperUploadDropzone
        libraryId={1}
        folderPath=""
        folderId={null}
      />,
    );
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["pdf"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const paperCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/papers" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(paperCall).toBeDefined();
    const body = JSON.parse(String((paperCall![1] as RequestInit).body));
    expect(body.folderId).toBeUndefined();
  });

  it("does NOT include folderId when folderId prop is omitted", async () => {
    mockFetchOk();
    render(<PaperUploadDropzone libraryId={1} folderPath="" />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["pdf"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const paperCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/papers" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(paperCall).toBeDefined();
    const body = JSON.parse(String((paperCall![1] as RequestInit).body));
    expect(body.folderId).toBeUndefined();
  });
});
