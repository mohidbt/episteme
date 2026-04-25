// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// ---- Mocks ----------------------------------------------------------------

// Use vi.hoisted so the variables are available inside vi.mock() factories
// (which are hoisted to the top of the file by vitest's transformer).
const { mockDestroy, mockCreateCollabProvider, mockEditor } = vi.hoisted(() => {
  const mockDestroy = vi.fn();
  const mockCreateCollabProvider = vi.fn(() => ({
    ydoc: {} as any,
    provider: {} as any,
    destroy: mockDestroy,
  }));
  const mockEditor = vi.fn(() => null);
  return { mockDestroy, mockCreateCollabProvider, mockEditor };
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

function renderNoteEditor(props?: { userName?: string }) {
  render(
    <NoteEditor
      id="note-1"
      initialMd="# Hello"
      userName={props?.userName ?? "alice"}
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

  it("calls createCollabProvider with the JWT token from /api/collab/token", async () => {
    renderNoteEditor({ userName: "bob" });
    // Flush the fetch promise microtasks
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalled());
    expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1);
    expect(mockCreateCollabProvider).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: "note-1", token: "fake-jwt" }),
    );
  });

  it("passes the correct url from NEXT_PUBLIC_COLLAB_URL", async () => {
    renderNoteEditor();
    await vi.waitFor(() => expect(mockCreateCollabProvider).toHaveBeenCalled());
    expect(mockCreateCollabProvider).toHaveBeenCalledWith(
      expect.objectContaining({ url: "ws://localhost:1234" }),
    );
  });

  it("does NOT call createCollabProvider when token fetch returns non-OK", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response);
    renderNoteEditor();
    // Give time for the async fetch to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(mockCreateCollabProvider).not.toHaveBeenCalled();
  });

  it("passes userName as collab user.name to Editor", async () => {
    renderNoteEditor({ userName: "bob" });
    await vi.waitFor(() => {
      const calls = mockEditor.mock.calls;
      const collabProps = calls.map((args: any[]) => args[0]?.collab?.user?.name).filter(Boolean);
      expect(collabProps).toContain("bob");
    });
  });
});
