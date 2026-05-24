// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FileBrowserToolbar } from "./FileBrowserToolbar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

vi.mock("@/components/NewItemTrigger", () => ({
  NewItemTrigger: () => null,
}));

vi.mock("@/components/UnifiedDropzone", () => ({
  UnifiedDropzone: () => null,
}));

afterEach(() => cleanup());

describe("FileBrowserToolbar import dialog copy", () => {
  it("describes the supported import file matrix", () => {
    render(
      <FileBrowserToolbar
        libraryId={1}
        libraryName="lib"
        folderId={null}
        folderChain={[]}
        view="tile"
        onViewChange={() => {}}
        onMutate={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /import/i }));

    const desc = screen.getByText(/Drop or choose/i).textContent ?? "";
    expect(desc).toContain("PDFs");
    expect(desc).toContain("notes (.md)");
    expect(desc).toContain("references (.bib, .ris, .csljson)");
    expect(desc).toContain("images");
  });
});
