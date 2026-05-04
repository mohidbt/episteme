// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { PapersetTable } from "./PapersetTable";
import type { FolderRow } from "@/lib/folders";

afterEach(() => cleanup());

const folders: FolderRow[] = [
  { id: "f1", parentId: null, name: "Research", isTrash: false },
];

const baseRow = {
  columns: [{ name: "c1", description: "" }],
  rowRefs: [{ paper_id: "p1" }],
  updatedAt: new Date("2026-01-15T00:00:00Z"),
};

describe("PapersetTable", () => {
  it("renders a row per paperset", () => {
    render(
      <PapersetTable
        rows={[
          { ...baseRow, id: "ps1", filename: "alpha.csv", folderId: null },
          { ...baseRow, id: "ps2", filename: "beta.csv", folderId: "f1" },
        ]}
        folders={folders}
      />,
    );
    expect(screen.getByRole("link", { name: /^alpha$/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /^beta$/i })).toBeDefined();
    expect(screen.queryByText("alpha.csv")).toBeNull();
    expect(screen.queryByText("beta.csv")).toBeNull();
    // Folder column shows breadcrumb for f1
    expect(screen.getByText("Research")).toBeDefined();
  });

  it("renders empty state when zero rows", () => {
    render(<PapersetTable rows={[]} folders={folders} />);
    expect(
      screen.getByText(/no papersets yet/i),
    ).toBeDefined();
  });

  it("each row links to /d/:id", () => {
    render(
      <PapersetTable
        rows={[
          { ...baseRow, id: "ps1", filename: "alpha.csv", folderId: null },
          { ...baseRow, id: "ps2", filename: "beta.csv", folderId: "f1" },
        ]}
        folders={folders}
      />,
    );
    const link1 = screen.getByRole("link", { name: /^alpha$/i });
    const link2 = screen.getByRole("link", { name: /^beta$/i });
    expect(link1.getAttribute("href")).toBe("/d/ps1");
    expect(link2.getAttribute("href")).toBe("/d/ps2");
  });

  it("shows column count and row count", () => {
    render(
      <PapersetTable
        rows={[
          {
            id: "ps1",
            filename: "alpha.csv",
            folderId: null,
            columns: [
              { name: "a", description: "" },
              { name: "b", description: "" },
              { name: "c", description: "" },
            ],
            rowRefs: [{ paper_id: "p1" }, { paper_id: "p2" }],
            updatedAt: new Date(),
          },
        ]}
        folders={folders}
      />,
    );
    const row = screen.getByRole("link", { name: /^alpha$/i }).closest("tr")!;
    expect(within(row).getByText("3")).toBeDefined();
    expect(within(row).getByText("2")).toBeDefined();
  });

  it("trims filename before removing trailing .csv", () => {
    render(
      <PapersetTable
        rows={[
          { ...baseRow, id: "ps1", filename: "  mixed.CSV  ", folderId: null },
        ]}
        folders={folders}
      />,
    );
    expect(screen.getByRole("link", { name: /^mixed$/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /csv/i })).toBeNull();
  });
});
