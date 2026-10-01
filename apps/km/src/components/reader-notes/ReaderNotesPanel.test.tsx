// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const openInNewTab = vi.hoisted(() => vi.fn());
vi.mock("@/components/TabBar", () => ({ useTabs: () => ({ openInNewTab }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/(app)/n/[slug]/NoteEditor", () => ({
  NoteEditor: (props: { id: string; initialMd: string; autofocus?: boolean }) => (
    <div data-testid="note-editor" data-note-id={props.id} data-autofocus={String(props.autofocus)}>
      {props.initialMd}
    </div>
  ),
}));

import { ReaderNotesPanel } from "./ReaderNotesPanel";

const NOTES: Record<string, { id: string; title: string; slug: string; contentMd: string; inTrash: boolean }> = {
  n1: { id: "n1", title: "First note", slug: "first-note", contentMd: "First body", inTrash: false },
  n2: { id: "n2", title: "Second note", slug: "second-note", contentMd: "Second body", inTrash: false },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Overridable per test: the response for GET /api/notes/:id.
let noteResponse: (id: string) => Response;

const onNoteIdChange = vi.fn();

function panel(noteId: string | null) {
  return (
    <ReaderNotesPanel
      paperTitle="Paper"
      libraryId={1}
      folderId={null}
      noteId={noteId}
      onNoteIdChange={onNoteIdChange}
      dockControl={<span data-testid="dock-control" />}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  noteResponse = (id) => (NOTES[id] ? json(NOTES[id]) : json({ error: "not_found" }, 404));
  globalThis.fetch = vi.fn(async (input: string) => {
    const { pathname } = new URL(input, "http://test");
    if (pathname === "/api/notes/search") return json({ results: Object.values(NOTES) });
    if (pathname.endsWith("/resolved-links")) return json({});
    return noteResponse(pathname.split("/").pop()!);
  }) as unknown as typeof fetch;
});

afterEach(cleanup);

describe("ReaderNotesPanel", () => {
  it("shows the picker inline when the paper has no note", async () => {
    render(panel(null));
    expect(screen.getByTestId("note-picker-trigger").textContent).toBe("Choose a note");
    expect(screen.getByTestId("reader-notes-body").contains(screen.getByTestId("note-picker"))).toBe(true);
    await screen.findByText("First note");
    expect(screen.queryByTestId("note-editor")).toBeNull();
    expect(screen.queryByTestId("reader-notes-open-in-tab")).toBeNull();
    expect(screen.getByTestId("dock-control")).toBeTruthy();
  });

  it("loads the remembered note without taking focus", async () => {
    render(panel("n1"));
    const editor = await screen.findByTestId("note-editor");
    expect(editor.textContent).toBe("First body");
    expect(editor.dataset.autofocus).toBe("false");
    expect(screen.getByTestId("note-picker-trigger").textContent).toBe("First note");
    expect(screen.getByTestId("reader-notes-sync").dataset.syncStatus).toBe("synced");
    expect(onNoteIdChange).not.toHaveBeenCalled();
  });

  it("opens the note in a background tab", async () => {
    render(panel("n1"));
    fireEvent.click(await screen.findByTestId("reader-notes-open-in-tab"));
    expect(openInNewTab).toHaveBeenCalledWith("/n/first-note", "First note");
  });

  it("forgets a remembered note that no longer exists", async () => {
    render(panel("gone"));
    await waitFor(() => expect(onNoteIdChange).toHaveBeenCalledWith(null));
    expect(screen.queryByTestId("note-editor")).toBeNull();
  });

  it("forgets a remembered note that is in the trash", async () => {
    noteResponse = () => json({ ...NOTES.n1, inTrash: true });
    render(panel("n1"));
    await waitFor(() => expect(onNoteIdChange).toHaveBeenCalledWith(null));
    expect(screen.queryByTestId("note-editor")).toBeNull();
  });

  it("keeps the note and offers a retry when the load fails", async () => {
    noteResponse = () => json({ error: "boom" }, 500);
    render(panel("n1"));
    await screen.findByText("Couldn't load this note.");
    expect(onNoteIdChange).not.toHaveBeenCalled();

    noteResponse = (id) => json(NOTES[id]);
    fireEvent.click(screen.getByText("Retry"));
    expect((await screen.findByTestId("note-editor")).textContent).toBe("First body");
  });

  it("switches notes from the header picker and focuses the new one", async () => {
    const { rerender } = render(panel("n1"));
    await screen.findByTestId("note-editor");

    fireEvent.click(screen.getByTestId("note-picker-trigger"));
    fireEvent.click(await screen.findByText("Second note"));
    expect(onNoteIdChange).toHaveBeenCalledWith("n2");

    rerender(panel("n2"));
    await waitFor(() =>
      expect(screen.getByTestId("note-editor").dataset.noteId).toBe("n2"),
    );
    expect(screen.getByTestId("note-editor").textContent).toBe("Second body");
    expect(screen.getByTestId("note-editor").dataset.autofocus).toBe("true");
    expect(screen.getByTestId("note-picker-trigger").textContent).toBe("Second note");
    await waitFor(() => expect(screen.queryByTestId("note-picker")).toBeNull());
  });
});
