// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

// ---- Mocks ----------------------------------------------------------------

// Use vi.hoisted so the variables are available inside vi.mock() factories
// (which are hoisted to the top of the file by vitest's transformer).
const { mockDestroy, mockCreateCollabProvider, mockEditor, lastProvider } = vi.hoisted(() => {
  const mockDestroy = vi.fn();

  // Minimal event-emitter shim — mirrors HocuspocusProvider's EventEmitter API.
  function makeProviderShim() {
    const listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
    return {
      on(event: string, fn: (...args: any[]) => void) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(fn);
      },
      off(event: string, fn?: (...args: any[]) => void) {
        if (!fn) { listeners.delete(event); return; }
        const cbs = listeners.get(event) ?? [];
        listeners.set(event, cbs.filter((cb) => cb !== fn));
      },
      emit(event: string, ...args: any[]) {
        (listeners.get(event) ?? []).forEach((fn) => fn(...args));
      },
    };
  }

  // lastProvider holds a reference to the most-recently created shim so tests
  // can emit events on it after render.
  const lastProvider = { current: makeProviderShim() };

  const mockCreateCollabProvider = vi.fn(() => {
    const shim = makeProviderShim();
    lastProvider.current = shim;
    return {
      ydoc: {} as any,
      provider: shim as any,
      destroy: mockDestroy,
    };
  });

  const mockEditor = vi.fn(() => null);
  return { mockDestroy, mockCreateCollabProvider, mockEditor, lastProvider };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@episteme/editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@episteme/editor")>();
  return {
    ...actual,
    // Keep the Editor component as a no-op stub — we only care about
    // createCollabProvider being called (or not).
    Editor: mockEditor,
    createCollabProvider: mockCreateCollabProvider,
  };
});

// Mock sub-components that would pull in heavy dependencies
vi.mock("@/components/WikiLinkTypeahead", () => ({
  WikiLinkTypeahead: vi.fn(() => null),
}));
vi.mock("@/components/SlashCommandTypeahead", () => ({
  SlashCommandTypeahead: vi.fn(() => null),
}));
vi.mock("@/components/AiBubbleMenu", () => ({
  AiBubbleMenu: vi.fn(() => null),
}));

// ---- Flag mocking via @/lib/flags ----------------------------------------
// We control COLLAB_ENABLED by mocking the flags module rather than
// messing with process.env + module reloads (vitest ESM doesn't support
// require() for relative paths inside vitest's virtual module graph).

let mockCollabEnabled = false;

vi.mock("@/lib/flags", () => ({
  get COLLAB_ENABLED() { return mockCollabEnabled; },
  COLLAB_URL: "ws://localhost:1234",
}));

// ---- Import subject under test -------------------------------------------
// Import after all vi.mock() calls so hoisting works correctly.
import { NoteEditor } from "./NoteEditor";

// ---- Helpers --------------------------------------------------------------

function renderNoteEditor(props?: { userName?: string; initialCollabToken?: string | null }) {
  render(
    <NoteEditor
      id="note-1"
      initialMd="# Hello"
      userName={props?.userName ?? "alice"}
      initialCollabToken={props?.initialCollabToken}
    />,
  );
}

// ---- Tests ----------------------------------------------------------------

describe("NoteEditor – COLLAB_ENABLED=false (default)", () => {
  beforeEach(() => {
    mockCollabEnabled = false;
    mockCreateCollabProvider.mockClear();
    mockDestroy.mockClear();
    mockEditor.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("does NOT call createCollabProvider when flag is off", () => {
    renderNoteEditor();
    expect(mockCreateCollabProvider).not.toHaveBeenCalled();
  });

  it("autosave PATCH fetch IS called with /api/notes/:id/content when collab is off and user types", async () => {
    // Mock global fetch so we can assert it was called
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", mockFetch);

    try {
      renderNoteEditor();

      // The Editor stub received onChangeMd as a prop — call it to simulate typing.
      // The component registers onChangeMd in mockEditor's props on each render call.
      const onChangeMd = mockEditor.mock.calls
        .map((args: any[]) => args[0]?.onChangeMd)
        .find(Boolean) as ((md: string) => void) | undefined;

      expect(onChangeMd).toBeDefined();
      onChangeMd!("typed content");

      // cleanup() unmounts the component which triggers the useEffect teardown
      // calling flush() synchronously with the pending content.
      cleanup();

      // flush() is async (fetch), so await the next microtask
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/notes/note-1/content",
        expect.objectContaining({ method: "PATCH" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("NoteEditor – COLLAB_ENABLED=true", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCollabEnabled = true;
    mockCreateCollabProvider.mockClear();
    mockDestroy.mockClear();
    mockEditor.mockClear();
    // Mock fetch to return a fake JWT token from /api/collab/token
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "fake-jwt" }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mockCollabEnabled = false;
  });

  // --- SSR token path (initialCollabToken provided) ---

  it("uses SSR token synchronously — createCollabProvider called on first render without fetch", async () => {
    renderNoteEditor({ userName: "bob", initialCollabToken: "ssr-jwt" });
    // With SSR token, provider is created synchronously (no async fetch needed)
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1));
    const callArg = (mockCreateCollabProvider.mock.calls as any[])[0][0];
    expect(callArg.noteId).toBe("note-1");
    expect(callArg.token).toBe("ssr-jwt");
    // fetch should NOT have been called for the token
    expect(mockFetch).not.toHaveBeenCalledWith("/api/collab/token", { method: "POST" });
  });

  it("passes the correct url from NEXT_PUBLIC_COLLAB_URL (SSR token path)", async () => {
    renderNoteEditor({ initialCollabToken: "ssr-jwt" });
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalled());
    expect(mockCreateCollabProvider).toHaveBeenCalledWith(
      expect.objectContaining({ url: "ws://localhost:1234" }),
    );
  });

  it("passes userName as collab user.name to Editor (SSR token path)", async () => {
    renderNoteEditor({ userName: "bob", initialCollabToken: "ssr-jwt" });
    await vi.waitFor(() => {
      const calls = mockEditor.mock.calls;
      const collabProps = calls.map((args: any[]) => args[0]?.collab?.user?.name).filter(Boolean);
      expect(collabProps).toContain("bob");
    });
  });

  // --- Fallback fetch path (no initialCollabToken) ---

  it("falls back to /api/collab/token fetch when no SSR token is provided", async () => {
    renderNoteEditor({ userName: "bob" });
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1));
    const callArg = (mockCreateCollabProvider.mock.calls as any[])[0][0];
    expect(callArg.token).toBe("fake-jwt");
    expect(mockFetch).toHaveBeenCalledWith("/api/collab/token", { method: "POST" });
  });

  it("does NOT call createCollabProvider when /api/collab/token returns non-OK", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response);
    renderNoteEditor();
    // Give the fetch promise time to reject
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCreateCollabProvider).not.toHaveBeenCalled();
  });

  it("creates a NEW collab provider when remounted with a different id (regression: drive-click navigation)", async () => {
    // Simulate the key={id} remount behavior in NotePageClient:
    // React unmounts NoteEditor and mounts a fresh one when id changes.
    // createCollabProvider must be called for each mount with the correct noteId.
    const { unmount: unmount1 } = render(
      <NoteEditor id="note-1" initialMd="# Note 1" userName="alice" initialCollabToken="ssr-jwt-1" />,
    );
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockCreateCollabProvider.mock.calls as any[])[0][0].noteId).toBe("note-1");

    // Simulate unmount (key change causes React to destroy the old NoteEditor)
    unmount1();
    mockCreateCollabProvider.mockClear();
    mockDestroy.mockClear();

    // Mount with a new id (simulates router navigating to a different note)
    render(<NoteEditor id="note-2" initialMd="# Note 2" userName="alice" initialCollabToken="ssr-jwt-2" />);
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockCreateCollabProvider.mock.calls as any[];
    expect(calls[0][0].noteId).toBe("note-2");
  });

  // --- Auth-failure token refresh (defense-in-depth for stale SSR token) ---

  it("refetches token and recreates provider when provider emits authenticationFailed", async () => {
    // Arrange: render with an SSR token so the provider is created immediately.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "fresh-jwt" }),
    } as Response);

    renderNoteEditor({ userName: "bob", initialCollabToken: "stale-jwt" });

    // Wait for the provider to be created with the stale token.
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1));
    expect((mockCreateCollabProvider.mock.calls as any[])[0][0].token).toBe("stale-jwt");

    // Act: simulate the provider reporting auth failure (e.g. cached stale JWT).
    lastProvider.current.emit("authenticationFailed", { reason: "Token expired" });

    // Assert: a fresh token fetch is triggered.
    await vi.waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/collab/token", { method: "POST" }),
    );

    // After the fetch resolves, a second provider must be created with the fresh token.
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalledTimes(2));
    const secondCallArg = (mockCreateCollabProvider.mock.calls as any[])[1][0];
    expect(secondCallArg.token).toBe("fresh-jwt");
  });

  it("does not spam the token endpoint on repeated authenticationFailed events", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "fresh-jwt-2" }),
    } as Response);

    renderNoteEditor({ userName: "carol", initialCollabToken: "stale-jwt-2" });

    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1));

    // Emit auth failure twice in rapid succession.
    lastProvider.current.emit("authenticationFailed", { reason: "expired" });
    lastProvider.current.emit("authenticationFailed", { reason: "expired" });

    // Allow microtasks/effects to settle.
    await new Promise((r) => setTimeout(r, 50));

    // Only ONE fetch should have been made (single-shot guard).
    const collabTokenFetchCalls = (mockFetch.mock.calls as any[][]).filter(
      ([url]) => url === "/api/collab/token",
    );
    expect(collabTokenFetchCalls).toHaveLength(1);
  });
});
