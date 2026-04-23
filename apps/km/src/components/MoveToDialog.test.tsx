// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MoveToDialog } from "./MoveToDialog";
import type { FolderRow } from "@/lib/folders";

const folders: FolderRow[] = [
  { id: "A", parentId: null, name: "A", isTrash: false },
  { id: "B", parentId: "A", name: "B", isTrash: false },
  { id: "C", parentId: null, name: "C", isTrash: false },
  { id: "T", parentId: null, name: "Trash", isTrash: true },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MoveToDialog", () => {
  it("renders Library root + 3 non-trash folders (trash excluded)", async () => {
    render(
      <MoveToDialog
        libraryId={1}
        folders={folders}
        currentFolderId={null}
        open
        onOpenChange={() => {}}
        onMove={async () => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("move-item-root")).toBeTruthy(),
    );
    expect(screen.getByTestId("move-item-A")).toBeTruthy();
    expect(screen.getByTestId("move-item-B")).toBeTruthy();
    expect(screen.getByTestId("move-item-C")).toBeTruthy();
    expect(screen.queryByTestId("move-item-T")).toBeNull();
  });

  it("filters folders by typing in the search input", async () => {
    render(
      <MoveToDialog
        libraryId={1}
        folders={folders}
        currentFolderId={null}
        open
        onOpenChange={() => {}}
        onMove={async () => {}}
      />,
    );
    const input = await waitFor(() =>
      screen.getByTestId("move-search-input"),
    );
    fireEvent.change(input, { target: { value: "B" } });
    await waitFor(() => {
      expect(screen.getByTestId("move-item-B")).toBeTruthy();
    });
    expect(screen.queryByTestId("move-item-C")).toBeNull();
  });

  it("select folder C then click Move calls onMove('C')", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <MoveToDialog
        libraryId={1}
        folders={folders}
        currentFolderId={null}
        open
        onOpenChange={() => {}}
        onMove={onMove}
      />,
    );
    const item = await waitFor(() => screen.getByTestId("move-item-C"));
    fireEvent.click(item);
    fireEvent.click(screen.getByTestId("move-confirm"));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("C"));
  });

  it("select Library root then Move calls onMove(null)", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <MoveToDialog
        libraryId={1}
        folders={folders}
        currentFolderId={null}
        open
        onOpenChange={() => {}}
        onMove={onMove}
      />,
    );
    const root = await waitFor(() => screen.getByTestId("move-item-root"));
    fireEvent.click(root);
    fireEvent.click(screen.getByTestId("move-confirm"));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(null));
  });

  it("excludeFolderId='A' hides A and descendant B", async () => {
    render(
      <MoveToDialog
        libraryId={1}
        folders={folders}
        currentFolderId={null}
        excludeFolderId="A"
        open
        onOpenChange={() => {}}
        onMove={async () => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("move-item-root")).toBeTruthy(),
    );
    expect(screen.queryByTestId("move-item-A")).toBeNull();
    expect(screen.queryByTestId("move-item-B")).toBeNull();
    expect(screen.getByTestId("move-item-C")).toBeTruthy();
  });
});
