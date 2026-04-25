// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import * as Y from "yjs";

// ---- Mocks ----------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

// Mock the editor package so we can spy on createCollabProvider
const mockDestroy = vi.fn();
const mockCreateCollabProvider = vi.fn(() => ({
  ydoc: new Y.Doc(),
  provider: {} as any,
  destroy: mockDestroy,
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

// ---- Helpers --------------------------------------------------------------

function renderNoteEditor(props?: { userName?: string }) {
  // Dynamic import after env vars are set so the module picks up the flag
  const { NoteEditor } = require("./NoteEditor");
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
    delete process.env.NEXT_PUBLIC_COLLAB;
    vi.resetModules();
    mockCreateCollabProvider.mockClear();
    mockDestroy.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does NOT call createCollabProvider when flag is off", () => {
    renderNoteEditor();
    expect(mockCreateCollabProvider).not.toHaveBeenCalled();
  });
});

describe("NoteEditor – COLLAB_ENABLED=true", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_COLLAB = "1";
    process.env.NEXT_PUBLIC_COLLAB_URL = "ws://localhost:1234";
    vi.resetModules();
    mockCreateCollabProvider.mockClear();
    mockDestroy.mockClear();
  });

  afterEach(() => {
    cleanup();
    delete process.env.NEXT_PUBLIC_COLLAB;
    delete process.env.NEXT_PUBLIC_COLLAB_URL;
    vi.restoreAllMocks();
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
