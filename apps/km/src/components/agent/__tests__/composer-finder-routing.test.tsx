// @vitest-environment jsdom
// GSD-96 R4 — RED. Finder drop routing by MIME/extension.
//
// Edge-case enumeration (per §12) — applicable subset:
//   - canonical:    PDF, .md, .bib, .ris, image, .csv, unknown ext
//   - empty:        no files dropped → no-op
//   - concurrent:   2 PDFs dropped together; each polls independently;
//                   send enables when BOTH ready (gate test)
//   - send-gate:    ANY non-ready chip disables send
//   - reject:       red chip surfaces, NO network call to any endpoint
//   - race:         finalize 4xx → error chip (send still gated until removed)
// Omissions:
//   - auth-fail: route-level (covered in API route tests).
//   - max-size: server-side enforcement (413 already covered in route tests).
//
// All cases must FAIL today because routing currently sends everything
// through /api/assets indiscriminately (which 400s for non-allowlisted MIME).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

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

function makeFile(name: string, type = "", size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

interface FetchScript {
  libraryId?: number;
  // Maps URL substring → response factory (called per request).
  // Tests inspect fetchMock.mock.calls after assertions.
}

function installFetch(script: FetchScript = {}) {
  const libraryId = script.libraryId ?? 7;
  const ingestState: Record<string, { chunksReady: boolean }> = {};

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/libraries") && method === "GET") {
      return new Response(JSON.stringify([{ id: libraryId }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // Paper ingest pipeline
    if (url.endsWith("/api/papers") && method === "POST") {
      const id = `paper-${Math.random().toString(36).slice(2, 8)}`;
      ingestState[id] = { chunksReady: false };
      return new Response(
        JSON.stringify({ paperId: id, uploadUrl: `https://up/${id}` }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://up/") && method === "PUT") {
      return new Response("", { status: 200 });
    }
    const finalizeMatch = url.match(/\/api\/papers\/([^/]+)\/finalize$/);
    if (finalizeMatch && method === "POST") {
      // schedule transition to ready after 1 poll
      const id = finalizeMatch[1];
      setTimeout(() => {
        if (ingestState[id]) ingestState[id].chunksReady = true;
      }, 0);
      return new Response(JSON.stringify({ id, title: "Paper" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const ingestMatch = url.match(/\/api\/papers\/([^/]+)\/ingest-status$/);
    if (ingestMatch && method === "GET") {
      const id = ingestMatch[1];
      const ready = ingestState[id]?.chunksReady ?? false;
      return new Response(
        JSON.stringify({
          chunksReadyAt: ready ? new Date().toISOString() : null,
          chandraStatus: ready ? "ready" : "pending",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Note from-file
    if (url.endsWith("/api/notes/from-file") && method === "POST") {
      return new Response(
        JSON.stringify({ id: "note-1", title: "My Note" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    // References from-bib
    if (url.endsWith("/api/references/from-bib") && method === "POST") {
      return new Response(
        JSON.stringify({
          created: 2,
          skipped: 0,
          errors: [],
          references: [
            { id: "ref-1", title: "BibRef 1" },
            { id: "ref-2", title: "BibRef 2" },
          ],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    // References import (RIS)
    if (url.endsWith("/api/references/import") && method === "POST") {
      return new Response(
        JSON.stringify({
          imported: 1,
          skipped: 0,
          conflicts: [],
          references: [{ id: "ref-r1", title: "RisRef 1" }],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    // Assets (images path)
    if (url.endsWith("/api/assets") && method === "POST") {
      return new Response(
        JSON.stringify({ assetId: "a-img-1", uploadUrl: "https://up-asset/" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://up-asset/" && method === "PUT") {
      return new Response("", { status: 200 });
    }

    return new Response("not_found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function drop(node: HTMLElement, files: File[]) {
  return act(async () => {
    fireEvent.drop(node, {
      dataTransfer: { files, types: ["Files"] },
    });
  });
}

beforeEach(() => {
  toastError.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Finder drop routing (GSD-96 R4)", () => {
  it("PDF drop → POST /api/papers + PUT + finalize fired", async () => {
    const fetchMock = installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("paper.pdf", "application/pdf")]);

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith("/api/papers"))).toBe(true);
      expect(urls.some((u) => /\/finalize$/.test(u))).toBe(true);
    });
  });

  it("PDF drop → chip shows analyzing then transitions to ready after chunks_ready_at", async () => {
    installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("paper.pdf", "application/pdf")]);

    // Analyzing label visible while chunks_ready_at is null.
    await waitFor(() => {
      expect(screen.getByText(/analyzing/i)).toBeTruthy();
    });

    // Advance polling timer (2s).
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    await waitFor(() => {
      expect(screen.queryByText(/analyzing/i)).toBeNull();
    });
  });

  it("Send button is disabled while any chip is non-ready", async () => {
    installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("paper.pdf", "application/pdf")]);

    await waitFor(() => {
      const send = screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
    });
  });

  it(".md drop → POST /api/notes/from-file (NOT /api/papers, NOT /api/assets)", async () => {
    const fetchMock = installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("note.md", "text/markdown")]);

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith("/api/notes/from-file"))).toBe(true);
      expect(urls.some((u) => u.endsWith("/api/papers"))).toBe(false);
    });
  });

  it(".bib drop → POST /api/references/from-bib", async () => {
    const fetchMock = installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("library.bib", "")]);

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith("/api/references/from-bib"))).toBe(true);
    });
  });

  it(".ris drop → POST /api/references/import", async () => {
    const fetchMock = installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("export.ris", "")]);

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith("/api/references/import"))).toBe(true);
    });
  });

  it("image drop → routes to legacy asset chip (GSD-41 path); no /api/papers, no /api/notes", async () => {
    const fetchMock = installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("pic.png", "image/png")]);

    // Asset chip queued (GSD-27 chip), NOT a finder lib-token chip.
    await waitFor(() => {
      expect(screen.getByText(/pic\.png/)).toBeTruthy();
    });
    expect(screen.queryByTestId("finder-chips")).toBeNull();

    // Routing did NOT misfire toward lib-token endpoints.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/api/papers"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/api/notes/from-file"))).toBe(false);
  });

  it(".csv drop → red rejection chip + NO API call", async () => {
    const fetchMock = installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("rows.csv", "text/csv")]);

    await waitFor(() => {
      expect(screen.getByText(/we cannot process this file/i)).toBeTruthy();
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/api/papers"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/api/assets"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/api/notes/from-file"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/api/references/from-bib"))).toBe(false);
  });

  it("unknown extension drop → red rejection chip + NO API call", async () => {
    const fetchMock = installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [makeFile("malware.exe", "application/x-msdownload")]);

    await waitFor(() => {
      expect(screen.getByText(/we cannot process this file/i)).toBeTruthy();
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/api/papers"))).toBe(false);
  });

  it("two PDFs dropped simultaneously → both poll, send enables when BOTH ready", async () => {
    installFetch();
    render(
      <DndContext>
        <AgentTranscript threadId="t1" />
      </DndContext>,
    );
    const dropzone = screen.getByTestId("chat-input-dropzone");
    await drop(dropzone, [
      makeFile("a.pdf", "application/pdf"),
      makeFile("b.pdf", "application/pdf"),
    ]);

    // Send disabled while both analyzing.
    await waitFor(() => {
      const send = screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
    });

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    await waitFor(() => {
      const send = screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement;
      expect(send.disabled).toBe(false);
    });
  });
});
