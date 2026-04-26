// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { UnifiedDropzone, detectFileType } from "./UnifiedDropzone";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

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

function dropFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", {
    value: [file],
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function mockFetch(handlers: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      // Check each method+url combo
      for (const [key, response] of Object.entries(handlers)) {
        if (url.startsWith(key)) {
          return new Response(JSON.stringify(response.body), { status: response.status });
        }
      }
      // Paper init
      if (url === "/api/papers" && (init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ paperId: "paper-1", uploadUrl: "" }), { status: 201 });
      }
      if (url.startsWith("/api/papers/") && url.endsWith("/finalize")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

describe("UnifiedDropzone", () => {
  it("renders the dropzone", () => {
    render(<UnifiedDropzone libraryId={1} folderPath="" folderId={null} />);
    expect(screen.getByRole("presentation")).toBeTruthy();
  });

  it("calls /api/notes/from-file when a .md file is dropped", async () => {
    mockFetch({
      "/api/notes/from-file": { status: 201, body: { id: "note-1", slug: "test-note", title: "Test" } },
    });

    render(<UnifiedDropzone libraryId={1} folderPath="" folderId={null} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["# Test Note\nContent"], "test.md", { type: "text/markdown" });

    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const noteCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/notes/from-file",
    );
    expect(noteCall).toBeDefined();
    const body = noteCall![1]?.body as FormData;
    expect(body.get("libraryId")).toBe("1");
  });

  it("calls /api/references/from-bib when a .bib file is dropped", async () => {
    mockFetch({
      "/api/references/from-bib": { status: 201, body: { created: 1, skipped: 0, errors: [] } },
    });

    render(<UnifiedDropzone libraryId={2} folderPath="" folderId={null} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const bib = `@article{test2024, title={Test}, author={T}, year={2024}}`;
    const file = new File([bib], "refs.bib", { type: "application/x-bibtex" });

    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const bibCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/references/from-bib",
    );
    expect(bibCall).toBeDefined();
    const body = bibCall![1]?.body as FormData;
    expect(body.get("libraryId")).toBe("2");
  });

  it("calls /api/papers via existing flow when a .pdf file is dropped", async () => {
    mockFetch({});

    render(<UnifiedDropzone libraryId={1} folderPath="" folderId={null} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["%PDF-"], "paper.pdf", { type: "application/pdf" });

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
  });

  it("shows toast.info for .csv files (data files not yet supported)", async () => {
    render(<UnifiedDropzone libraryId={1} folderPath="" folderId={null} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["col1,col2\n1,2"], "data.csv", { type: "text/csv" });

    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(toast.info)).toHaveBeenCalled();
    });

    const infoCall = vi.mocked(toast.info).mock.calls[0];
    expect(String(infoCall[0])).toMatch(/1\.3/);
  });

  it("detectFileType maps image extensions to 'image'", () => {
    for (const name of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.svg", "A.PNG"]) {
      const f = new File(["x"], name, { type: "" });
      expect(detectFileType(f)).toBe("image");
    }
    expect(detectFileType(new File(["x"], "a.pdf", { type: "" }))).toBe("paper");
    expect(detectFileType(new File(["x"], "a.md", { type: "" }))).toBe("note");
    expect(detectFileType(new File(["x"], "a.bib", { type: "" }))).toBe("reference");
    expect(detectFileType(new File(["x"], "a.csv", { type: "" }))).toBe("data");
    expect(detectFileType(new File(["x"], "a.xyz", { type: "" }))).toBe("unknown");
  });

  it("calls /api/assets when an image is dropped", async () => {
    mockFetch({
      "/api/assets": { status: 201, body: { assetId: "asset-1", uploadUrl: "http://example.com/put" } },
    });
    // Stub XHR so the PUT resolves without a real network call.
    class FakeXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 200;
      open() {}
      setRequestHeader() {}
      send() {
        setTimeout(() => this.onload?.(), 0);
      }
      abort() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);

    render(<UnifiedDropzone libraryId={3} folderPath="" folderId={null} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["bytes"], "pic.png", { type: "image/png" });

    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const assetsCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/assets" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(assetsCall).toBeDefined();
    const body = JSON.parse((assetsCall![1] as RequestInit).body as string);
    expect(body.libraryId).toBe(3);
    expect(body.contentType).toBe("image/png");
    expect(body.filename).toBe("pic.png");
  });

  it("shows toast.error for unknown extension files", async () => {
    render(<UnifiedDropzone libraryId={1} folderPath="" folderId={null} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["data"], "unknown.xyz", { type: "application/octet-stream" });

    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled();
    });
  });
});
