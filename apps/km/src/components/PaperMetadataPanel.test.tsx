// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PaperMetadataPanel } from "./PaperMetadataPanel";

// Mock toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const basePaper = {
  id: "paper-1",
  userId: "user-1",
  libraryId: 1,
  folderId: null,
  filename: "test.pdf",
  storageUrl: null,
  title: "Test Paper Title",
  authors: ["Author A"],
  year: 2024,
  doi: null,
  venue: null,
  abstractShort: null,
  folderPath: "",
  prevFolderId: null,
  sizeBytes: 1234,
  chandraStatus: "pending" as const,
  chandraCompletedAt: null,
  chunksReadyAt: null,
  addedAt: new Date(),
  updatedAt: new Date(),
};

describe("PaperMetadataPanel", () => {
  it("renders the Metadata heading", () => {
    render(<PaperMetadataPanel paper={basePaper} />);
    expect(screen.getByText("Metadata")).toBeTruthy();
  });

  it("renders InPapersetsBadge when papersetCount > 0", () => {
    render(
      <PaperMetadataPanel
        paper={basePaper}
        papersetCount={2}
        papersets={[
          { id: "ps-1", filename: "Set A" },
          { id: "ps-2", filename: "Set B" },
        ]}
      />,
    );
    expect(screen.getByText(/in 2 papersets/i)).toBeTruthy();
  });

  it("does not render badge when papersetCount is 0", () => {
    render(
      <PaperMetadataPanel
        paper={basePaper}
        papersetCount={0}
        papersets={[]}
      />,
    );
    expect(screen.queryByText(/papersets?/i)).toBeNull();
  });

  it("renders badge inside the metadata header row", () => {
    render(
      <PaperMetadataPanel
        paper={basePaper}
        papersetCount={1}
        papersets={[{ id: "ps-1", filename: "Set A" }]}
      />,
    );
    const heading = screen.getByText("Metadata");
    const row = heading.closest("[data-testid='metadata-header']");
    expect(row).toBeTruthy();
    expect(row!.querySelector("[data-testid='in-papersets-badge']")).toBeTruthy();
  });
});