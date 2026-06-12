// @vitest-environment jsdom
// GSD-27 file upload + GSD-105 (R6): AgentTranscript now mounts the Tiptap
// ChatComposer. File drops are routed through useChatAttachments directly
// (R4 finder routing is parked under _deferred/). Tests assert OBSERVABLE
// behavior — chips render, toasts fire, the network upload flow runs and
// the final outbound text contains the file token.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { AgentTranscript } from "../AgentTranscript";

beforeEach(() => {
  toastError.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeFile(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("AgentTranscript — file upload (GSD-27)", () => {
  it("renders a paperclip attach button with hidden file input", () => {
    render(<AgentTranscript threadId="t1" />);
    const attach = screen.getByRole("button", { name: /attach file/i });
    expect(attach).toBeTruthy();
    const input = screen.getByTestId("chat-file-input") as HTMLInputElement;
    expect(input.type).toBe("file");
  });

  it("drops a supported image file onto chat input and renders a chip", async () => {
    render(<AgentTranscript threadId="t1" />);
    const dropzone = screen.getByTestId("chat-input-dropzone");
    const file = makeFile("photo.png", "image/png");
    await act(async () => {
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file], types: ["Files"] },
      });
    });
    expect(screen.getByText(/photo\.png/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove photo\.png/i })).toBeTruthy();
  });

  it("rejects unsupported file types with a toast (GSD-105: R4 chip parked)", async () => {
    // GSD-105 parks R4 finder routing under _deferred/. File drops now go
    // directly through useChatAttachments which toasts on rejection (the
    // legacy GSD-27 behavior). The red-chip surface returns when finder
    // routing is resurrected — see apps/km/src/lib/agent/_deferred/.
    render(<AgentTranscript threadId="t1" />);
    const dropzone = screen.getByTestId("chat-input-dropzone");
    const file = makeFile("evil.exe", "application/x-msdownload");
    await act(async () => {
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file], types: ["Files"] },
      });
    });
    expect(toastError).toHaveBeenCalled();
    expect(String(toastError.mock.calls[0][0])).toMatch(/unsupported/i);
  });

  it("removes a chip when its remove button is clicked", async () => {
    render(<AgentTranscript threadId="t1" />);
    const dropzone = screen.getByTestId("chat-input-dropzone");
    const file = makeFile("photo.png", "image/png");
    await act(async () => {
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file], types: ["Files"] },
      });
    });
    const remove = screen.getByRole("button", { name: /remove photo\.png/i });
    fireEvent.click(remove);
    expect(screen.queryByText(/photo\.png/)).toBeNull();
  });

  it("on send: uploads each file via /api/assets and appends [Attached file: ...] token to message", async () => {
    // Mock the network flow:
    // 1. GET /api/libraries → [{ id: 7 }]
    // 2. POST /api/assets → { assetId: "a-1", uploadUrl: "https://up/" }
    // 3. PUT uploadUrl (presigned) → 200
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.endsWith("/api/libraries") && method === "GET") {
        return new Response(JSON.stringify([{ id: 7 }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.endsWith("/api/assets") && method === "POST") {
        return new Response(
          JSON.stringify({ assetId: "a-1", uploadUrl: "https://up/x" }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      if (u === "https://up/x" && method === "PUT") {
        return new Response("", { status: 200 });
      }
      return new Response("not_found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sent = vi.fn();
    render(<AgentTranscript threadId="t1" onSendMessage={sent} />);
    const dropzone = screen.getByTestId("chat-input-dropzone");
    const file = makeFile("photo.png", "image/png");
    await act(async () => {
      fireEvent.drop(dropzone, {
        dataTransfer: { files: [file], types: ["Files"] },
      });
    });
    // Drive the Tiptap surface via paste (jsdom-friendly): Tiptap's view
    // intercepts paste and inserts text into the doc, which the parent's
    // composer ref serializes on Send.
    const editor = screen.getByTestId("chat-composer-editor");
    await act(async () => {
      const clipboardData = {
        getData: (t: string) => (t === "text/plain" ? "look at this" : ""),
        types: ["text/plain"],
        files: [] as File[],
      };
      fireEvent.paste(editor, { clipboardData });
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sent).toHaveBeenCalled();
    });
    const sentText = sent.mock.calls[0][0] as string;
    expect(sentText).toContain("look at this");
    expect(sentText).toContain("[Attached file:");
    expect(sentText).toContain("photo.png");
    expect(sentText).toContain("assetId=a-1");

    // Verify upload requests fired.
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.endsWith("/api/libraries"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/api/assets"))).toBe(true);
    expect(calls.some((u) => u === "https://up/x")).toBe(true);
  });
});
