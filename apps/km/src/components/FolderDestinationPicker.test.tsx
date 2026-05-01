// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FolderDestinationPicker } from "./FolderDestinationPicker";
import type { FolderRow } from "@/lib/folders";

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

describe("FolderDestinationPicker", () => {
  it("excludes .episteme folder from the dropdown options", async () => {
    const onChange = vi.fn();
    render(
      <FolderDestinationPicker
        folders={[EPHEMERAL, REGULAR, TRASH]}
        value={null}
        onChange={onChange}
      />,
    );

    await fireEvent.click(screen.getByText("Library root"));

    const options = screen.getAllByRole("menuitem");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).not.toContain(".episteme");
    expect(optionTexts).toContain("Papers");
  });

  it("excludes descendants of .episteme from the dropdown options", async () => {
    const onChange = vi.fn();
    render(
      <FolderDestinationPicker
        folders={[EPHEMERAL, CHILD_OF_EPHEMERAL, REGULAR]}
        value={null}
        onChange={onChange}
      />,
    );

    await fireEvent.click(screen.getByText("Library root"));

    const options = screen.getAllByRole("menuitem");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).not.toContain(".episteme / skills");
    expect(optionTexts).toContain("Papers");
  });

  it("still excludes trash folders", async () => {
    const onChange = vi.fn();
    render(
      <FolderDestinationPicker
        folders={[REGULAR, TRASH]}
        value={null}
        onChange={onChange}
      />,
    );

    await fireEvent.click(screen.getByText("Library root"));

    const options = screen.getAllByRole("menuitem");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).not.toContain("Trash");
    expect(optionTexts).toContain("Papers");
  });
});