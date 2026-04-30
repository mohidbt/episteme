// @vitest-environment jsdom
/**
 * Task #5 — editable note title with dynamic confirm button.
 *
 * Title is rendered as an `<input data-testid="note-title">`. A confirm
 * button (`data-testid="note-title-confirm"`) appears only when the trimmed
 * draft differs from the initial title; clicking it PATCHes /api/notes/:id
 * with the new title.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

// NotePageClient imports NoteEditor (heavy), VersionDrawer, AskNotesPanel,
// PublishDialog, DownloadButton — stub them all to keep the test focused.
vi.mock("./NoteEditor", () => ({ NoteEditor: () => null }));
vi.mock("@/components/VersionDrawer", () => ({ VersionDrawer: () => null }));
vi.mock("@/components/AskNotesPanel", () => ({ AskNotesPanel: () => null }));
vi.mock("@/components/PublishDialog", () => ({ PublishDialog: () => null }));
vi.mock("@/components/DownloadButton", () => ({ DownloadButton: () => null }));

import { NotePageClient } from "./NotePageClient";

const baseProps = {
  id: "note-1",
  title: "Hello",
  initialMd: "",
  initialUsername: null,
  initialIsPublic: false,
  initialPublicSlug: null,
  noteSlug: "hello",
  userName: "alice",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NotePageClient — editable title", () => {
  it("renders the title as an input", () => {
    render(<NotePageClient {...baseProps} />);
    const input = screen.getByTestId("note-title") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("Hello");
  });

  it("does NOT show the confirm button when title is unchanged", () => {
    render(<NotePageClient {...baseProps} />);
    expect(screen.queryByTestId("note-title-confirm")).toBeNull();
  });

  it("shows the confirm button when the user types a different title", () => {
    render(<NotePageClient {...baseProps} />);
    const input = screen.getByTestId("note-title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello World" } });
    expect(screen.getByTestId("note-title-confirm")).toBeTruthy();
  });

  it("clicking confirm PATCHes /api/notes/:id with the new title", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "hello" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NotePageClient {...baseProps} />);
    const input = screen.getByTestId("note-title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello World" } });

    fireEvent.click(screen.getByTestId("note-title-confirm"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notes/note-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "Hello World" }),
        }),
      );
    });
  });

  it("hides the confirm button again when the draft is reset to the original title", () => {
    render(<NotePageClient {...baseProps} />);
    const input = screen.getByTestId("note-title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Different" } });
    expect(screen.getByTestId("note-title-confirm")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(screen.queryByTestId("note-title-confirm")).toBeNull();
  });
});
