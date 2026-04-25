// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// ---- Mocks ----------------------------------------------------------------

// Use vi.hoisted so the variables are available inside vi.mock() factories
// (which are hoisted to the top of the file by vitest's transformer).
const { mockDestroy, mockCreateCollabProvider } = vi.hoisted(() => {
  const mockDestroy = vi.fn();
  const mockCreateCollabProvider = vi.fn(() => ({
    ydoc: {} as any,
    provider: {} as any,
    destroy: mockDestroy,
  }));
  return { mockDestroy, mockCreateCollabProvider };
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
    Editor: vi.fn(() => null),
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
  });

  afterEach(() => {
    cleanup();
  });

  it("does NOT call createCollabProvider when flag is off", () => {
    renderNoteEditor();
    expect(mockCreateCollabProvider).not.toHaveBeenCalled();
  });
});

describe("NoteEditor – COLLAB_ENABLED=true", () => {
  beforeEach(() => {
    mockCollabEnabled = true;
    mockCreateCollabProvider.mockClear();
    mockDestroy.mockClear();
  });

  afterEach(() => {
    cleanup();
    mockCollabEnabled = false;
  });

  it("calls createCollabProvider exactly once with correct noteId", () => {
    renderNoteEditor({ userName: "bob" });
    expect(mockCreateCollabProvider).toHaveBeenCalledTimes(1);
    expect(mockCreateCollabProvider).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: "note-1" }),
    );
  });

  it("passes the correct url from NEXT_PUBLIC_COLLAB_URL", () => {
    renderNoteEditor();
    expect(mockCreateCollabProvider).toHaveBeenCalledWith(
      expect.objectContaining({ url: "ws://localhost:1234" }),
    );
  });
});
