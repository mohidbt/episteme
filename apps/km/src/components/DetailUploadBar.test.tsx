// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { DetailUploadBar } from "./DetailUploadBar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@episteme/auth/client", () => ({
  useSession: () => ({ data: { user: { isAnonymous: false } } }),
}));

import { toast } from "sonner";

const FOLDERS = [
  { id: "folder-a", parentId: null, name: "Alpha", isTrash: false },
  { id: "folder-b", parentId: null, name: "Beta", isTrash: false },
  { id: "trash-1", parentId: null, name: "Trash", isTrash: true },
];

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
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function mockFetchOk(extra?: (url: string, init?: RequestInit) => Response | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const ex = extra?.(url, init);
      if (ex) return ex;
      if (url === "/api/papers" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ paperId: "p1", uploadUrl: "" }),
          { status: 201 },
        );
      }
      if (url.startsWith("/api/papers/") && url.endsWith("/finalize")) {
        return new Response("{}", { status: 200 });
      }
      if (url === "/api/notes/from-file" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "n1" }), { status: 201 });
      }
      if (url === "/api/references/import" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ imported: 1, skipped: 0, conflicts: [] }),
          { status: 201 },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

describe("DetailUploadBar", () => {
  it("renders an upload affordance and a folder picker", () => {
    render(
      <DetailUploadBar
        kind="paper"
        libraryId={1}
        folders={FOLDERS}
        defaultFolderId={null}
      />,
    );
    expect(screen.getByTestId("detail-upload-input")).toBeTruthy();
    expect(screen.getByTestId("detail-upload-folder-trigger")).toBeTruthy();
  });

  it("uses the chosen folderId in the upload payload (paper)", async () => {
    mockFetchOk();
    render(
      <DetailUploadBar
        kind="paper"
        libraryId={1}
        folders={FOLDERS}
        defaultFolderId={null}
      />,
    );

    // Open the picker, choose folder Beta
    fireEvent.click(screen.getByTestId("detail-upload-folder-trigger"));
    await waitFor(() =>
      expect(screen.getByText("Beta")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Beta"));

    const input = screen.getByTestId("detail-upload-input") as HTMLInputElement;
    const file = new File(["pdf"], "x.pdf", { type: "application/pdf" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });
    const fetchMock = vi.mocked(globalThis.fetch);
    const initCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/papers" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(initCall).toBeDefined();
    const body = JSON.parse(String((initCall![1] as RequestInit).body));
    expect(body.folderId).toBe("folder-b");
  });

  it("rejects unsupported file type with a user-readable error", async () => {
    mockFetchOk();
    render(
      <DetailUploadBar
        kind="paper"
        libraryId={1}
        folders={FOLDERS}
        defaultFolderId={null}
      />,
    );

    const input = screen.getByTestId("detail-upload-input") as HTMLInputElement;
    const file = new File(["hi"], "wrong.md", { type: "text/markdown" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      const calls = vi.mocked(toast.error).mock.calls;
      const hit = calls.find((c) =>
        String(c[0]).toLowerCase().includes("only pdf"),
      );
      expect(hit).toBeDefined();
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const initCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/papers" && (c[1] as RequestInit)?.method === "POST",
    );
    expect(initCall).toBeUndefined();
  });

  it("note kind posts to /api/notes/from-file with chosen folderId", async () => {
    mockFetchOk();
    render(
      <DetailUploadBar
        kind="note"
        libraryId={2}
        folders={FOLDERS}
        defaultFolderId="folder-a"
      />,
    );

    const input = screen.getByTestId("detail-upload-input") as HTMLInputElement;
    const file = new File(["# hello"], "x.md", { type: "text/markdown" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      const fetchMock = vi.mocked(globalThis.fetch);
      const noteCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/notes/from-file",
      );
      expect(noteCall).toBeDefined();
    });
    const fetchMock = vi.mocked(globalThis.fetch);
    const noteCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/notes/from-file",
    );
    const form = (noteCall![1] as RequestInit).body as FormData;
    expect(form.get("folderId")).toBe("folder-a");
    expect(form.get("libraryId")).toBe("2");
  });

  it("reference kind posts to /api/references/import for .ris", async () => {
    mockFetchOk();
    render(
      <DetailUploadBar
        kind="reference"
        libraryId={3}
        folders={FOLDERS}
        defaultFolderId={null}
      />,
    );

    const input = screen.getByTestId("detail-upload-input") as HTMLInputElement;
    const file = new File(["TY  - JOUR"], "x.ris", { type: "" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      const fetchMock = vi.mocked(globalThis.fetch);
      const refCall = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/references/import",
      );
      expect(refCall).toBeDefined();
    });
  });

  it("blocks upload and shows sign-in toast when isAnonymous=true", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DetailUploadBar
        kind="paper"
        libraryId={1}
        folders={FOLDERS}
        defaultFolderId={null}
        isAnonymous
      />,
    );
    const input = screen.getByTestId("detail-upload-input") as HTMLInputElement;
    const file = new File(["pdf"], "x.pdf", { type: "application/pdf" });
    await act(async () => {
      dropFile(input, file);
    });

    await waitFor(() => {
      const errorCall = vi.mocked(toast.error).mock.calls.find((c) =>
        String(c[0]).toLowerCase().includes("sign in"),
      );
      expect(errorCall).toBeDefined();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
