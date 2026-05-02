// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { ConfigExportImport } from "./ConfigExportImport";

const sampleDiff = {
  skills: { added: [".episteme/agents/skills/foo.md"], removed: [], modified: [] },
  personalSkills: { added: ["tone"], removed: [], modified: [] },
  memories: { added: [], removed: [], modified: [".episteme/agents/memories/bar.md"] },
  settings: { changed: ["modelPreference"] },
};

beforeEach(() => {
  // jsdom doesn't implement these
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function mockFetchSequence(handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
  let i = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = handlers[i] ?? handlers[handlers.length - 1];
    i += 1;
    return handler(url, init);
  }) as unknown as typeof fetch;
}

describe("ConfigExportImport", () => {
  it("renders Export and Import controls", () => {
    render(<ConfigExportImport />);
    expect(screen.getByTestId("agent-config-export-button")).toBeTruthy();
    expect(screen.getByTestId("agent-config-import-input")).toBeTruthy();
    expect(screen.getByTestId("agent-config-import-button")).toBeTruthy();
  });

  it("import button renders Add Zip File text", () => {
    render(<ConfigExportImport />);
    expect(screen.getByText("Add Zip File")).toBeTruthy();
  });

  it("clicking Export fetches /api/agent/export and triggers a download", async () => {
    mockFetchSequence([
      async () =>
        new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" }), {
          status: 200,
        }),
    ]);
    render(<ConfigExportImport />);
    fireEvent.click(screen.getByTestId("agent-config-export-button"));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(
        calls.some((c) => typeof c[0] === "string" && (c[0] as string).includes("/api/agent/export")),
      ).toBe(true);
    });
    await waitFor(() => {
      expect((globalThis.URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
  });

  it("picking a file POSTs to /api/agent/import without confirm and opens diff dialog", async () => {
    mockFetchSequence([
      async () =>
        new Response(JSON.stringify({ diff: sampleDiff }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ]);
    render(<ConfigExportImport />);
    const input = screen.getByTestId("agent-config-import-input") as HTMLInputElement;
    const file = new File(["zipdata"], "bundle.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const post = calls.find(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/api/agent/import"),
      );
      expect(post).toBeTruthy();
      const fd = (post![1] as RequestInit).body as FormData;
      expect(fd.get("confirm")).toBe(null);
    });
    await waitFor(() => {
      expect(screen.getByTestId("agent-config-diff-dialog")).toBeTruthy();
    });
    expect(screen.getByText(/foo\.md/)).toBeTruthy();
    expect(screen.getByText(/bar\.md/)).toBeTruthy();
    expect(screen.getByText(/modelPreference/)).toBeTruthy();
  });

  it("clicking Apply re-POSTs with confirm=true and closes dialog", async () => {
    mockFetchSequence([
      async () =>
        new Response(JSON.stringify({ diff: sampleDiff }), { status: 200 }),
      async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);
    render(<ConfigExportImport />);
    const input = screen.getByTestId("agent-config-import-input") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["zipdata"], "b.zip")] },
    });

    await waitFor(() => screen.getByTestId("agent-config-diff-dialog"));
    fireEvent.click(screen.getByTestId("agent-config-apply-button"));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const confirms = calls.filter((c) => {
        if (typeof c[0] !== "string") return false;
        if (!(c[0] as string).includes("/api/agent/import")) return false;
        const body = (c[1] as RequestInit | undefined)?.body;
        return body instanceof FormData && body.get("confirm") === "true";
      });
      expect(confirms.length).toBe(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("agent-config-diff-dialog")).toBeNull();
    });
    expect((toast.success as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("clicking Cancel closes the dialog without a second POST", async () => {
    mockFetchSequence([
      async () => new Response(JSON.stringify({ diff: sampleDiff }), { status: 200 }),
    ]);
    render(<ConfigExportImport />);
    const input = screen.getByTestId("agent-config-import-input") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["zipdata"], "b.zip")] },
    });
    await waitFor(() => screen.getByTestId("agent-config-diff-dialog"));

    fireEvent.click(screen.getByTestId("agent-config-cancel-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("agent-config-diff-dialog")).toBeNull();
    });
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const importCalls = calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/api/agent/import"),
    );
    expect(importCalls.length).toBe(1);
  });

  it("400 from import surfaces toast.error and dialog stays closed", async () => {
    mockFetchSequence([
      async () =>
        new Response(JSON.stringify({ error: "invalid_bundle" }), { status: 400 }),
    ]);
    render(<ConfigExportImport />);
    const input = screen.getByTestId("agent-config-import-input") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["zipdata"], "b.zip")] },
    });

    await waitFor(() => {
      expect((toast.error as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("agent-config-diff-dialog")).toBeNull();
  });
});

describe("ConfigExportImport layout (#142)", () => {
  it("renders Export section before Import section in DOM order", () => {
    render(<ConfigExportImport />);
    const exportHeading = screen.getByText("Export");
    const importHeading = screen.getByText("Import");
    // Export heading should come before Import heading in DOM order
    expect(
      exportHeading.compareDocumentPosition(importHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses vertical layout (no side-by-side flex-row on sm)", () => {
    const { container } = render(<ConfigExportImport />);
    const root = container.firstChild as HTMLElement;
    // The root div should NOT have sm:flex-row
    expect(root.className).not.toContain("sm:flex-row");
  });
});
