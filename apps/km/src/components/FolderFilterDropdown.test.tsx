// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FolderFilterDropdown } from "./FolderFilterDropdown";
import type { FolderRow } from "@/lib/folders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => cleanup());

const EPHEMERAL: FolderRow = {
  id: "ephermeral-1",
  parentId: null,
  name: ".episteme",
  isTrash: false,
};

const REGULAR: FolderRow = {
  id: "folder-a",
  parentId: null,
  name: "Papers",
  isTrash: false,
};

const TRASH: FolderRow = {
  id: "trash-1",
  parentId: null,
  name: "Trash",
  isTrash: true,
};

const CHILD_OF_EPHEMERAL: FolderRow = {
  id: "child-hidden",
  parentId: "ephermeral-1",
  name: "skills",
  isTrash: false,
};

describe("FolderFilterDropdown", () => {
  it("excludes .episteme folder from the dropdown options", async () => {
    render(
      <FolderFilterDropdown
        folders={[EPHEMERAL, REGULAR, TRASH]}
        activeFolderId={null}
        basePath="/papers"
      />,
    );

    await fireEvent.click(screen.getByText("Folder"));

    const options = screen.getAllByRole("menuitem");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).not.toContain(".episteme");
    expect(optionTexts).toContain("Papers");
  });

  it("excludes descendants of .episteme from the dropdown options", async () => {
    render(
      <FolderFilterDropdown
        folders={[EPHEMERAL, CHILD_OF_EPHEMERAL, REGULAR]}
        activeFolderId={null}
        basePath="/papers"
      />,
    );

    await fireEvent.click(screen.getByText("Folder"));

    const options = screen.getAllByRole("menuitem");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).not.toContain(".episteme");
    expect(optionTexts).not.toContain(".episteme / skills");
    expect(optionTexts).toContain("Papers");
  });

  it("still excludes trash folders", async () => {
    render(
      <FolderFilterDropdown
        folders={[REGULAR, TRASH]}
        activeFolderId={null}
        basePath="/papers"
      />,
    );

    await fireEvent.click(screen.getByText("Folder"));

    const options = screen.getAllByRole("menuitem");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).not.toContain("Trash");
    expect(optionTexts).toContain("Papers");
  });
});