// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {},
    push: (url: string) => pushMock(url),
  }),
  usePathname: () => "/",
}));

import { FileBrowser } from "./FileBrowser";
import type { FolderContents } from "@/lib/folders-server";

// updatedAt must be a serializable form for RSC boundary, but the component
// accepts either Date or string/number; here we use Date for the test since
// FolderContents type uses Date — serialization happens in the page, not here.
const NOW = new Date("2026-04-20T10:00:00.000Z");

const baseContents: FolderContents = {
  folders: [
    {
      id: "f1",
      name: "Research",
      isTrash: false,
      sortOrder: 0,
      updatedAt: NOW,
    },
  ],
  papers: [
    {
      kind: "paper",
      id: "p1",
      title: "On Attention",
      folderId: null,
      updatedAt: NOW,
    },
  ],
  references: [],
  notes: [
    {
      kind: "note",
      id: "n1",
      title: "My note",
      folderId: null,
      slug: "my-note",
      updatedAt: NOW,
    },
  ],
};

afterEach(() => {
  cleanup();
  pushMock.mockReset();
});

describe("FileBrowser", () => {
  it("renders three items in tile view by default", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
      />,
    );
    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("On Attention")).toBeTruthy();
    expect(screen.getByText("My note")).toBeTruthy();
  });

  it("clicking a folder navigates to /drive/<encoded name>", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
      />,
    );
    const folderEl = screen.getByTestId("fb-item-f1");
    fireEvent.click(folderEl);
    expect(pushMock).toHaveBeenCalledWith(
      `/drive/${encodeURIComponent("Research")}`,
    );
  });

  it("note link href points to /n/<slug>", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
      />,
    );
    const note = screen.getByTestId("fb-item-n1");
    const anchor =
      note.tagName === "A" ? note : (note.querySelector("a") as HTMLElement);
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute("href")).toBe("/n/my-note");
  });

  it("toggling to list view renders a table with Name/Type/Folder/Updated columns", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={baseContents}
      />,
    );
    fireEvent.click(screen.getByTestId("fb-view-list"));
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const headerText = headers.map((h) => h.textContent);
    expect(headerText).toEqual(["Name", "Type", "Folder", "Updated"]);
    expect(within(table).getByText("Research")).toBeTruthy();
    expect(within(table).getByText("On Attention")).toBeTruthy();
    expect(within(table).getByText("My note")).toBeTruthy();
  });

  it("renders empty state when no items", () => {
    render(
      <FileBrowser
        libraryId={1}
        libraryName="Default"
        folderId={null}
        folderChain={[]}
        contents={{ folders: [], papers: [], references: [], notes: [] }}
      />,
    );
    expect(
      screen.getByText(/Drop files here, or click/i),
    ).toBeTruthy();
  });
});
