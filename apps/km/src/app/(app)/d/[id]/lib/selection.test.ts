import { describe, it, expect } from "vitest";
import { CellSelection } from "./selection";

describe("CellSelection", () => {
  it("click selects a single empty cell", () => {
    const s = new CellSelection({
      filledKeys: new Set(["0:x"]),
      rowCount: 3,
      cols: ["x", "y"],
    });
    s.click({ row: 0, col: "y" });
    expect(s.list()).toEqual([{ row: 0, col: "y" }]);
  });

  it("click on a filled cell clears selection", () => {
    const s = new CellSelection({
      filledKeys: new Set(["0:x"]),
      rowCount: 3,
      cols: ["x"],
    });
    s.click({ row: 0, col: "x" });
    expect(s.size()).toBe(0);
  });

  it("shift-range, skipping filled cells", () => {
    const s = new CellSelection({
      filledKeys: new Set(["1:x"]),
      rowCount: 3,
      cols: ["x"],
    });
    s.click({ row: 0, col: "x" });
    s.shiftClick({ row: 2, col: "x" });
    expect(s.list().sort((a, b) => a.row - b.row)).toEqual([
      { row: 0, col: "x" },
      { row: 2, col: "x" },
    ]);
  });

  it("cmd-click unions empty cells", () => {
    const s = new CellSelection({
      filledKeys: new Set<string>(),
      rowCount: 3,
      cols: ["x", "y"],
    });
    s.click({ row: 0, col: "x" });
    s.cmdClick({ row: 1, col: "y" });
    s.cmdClick({ row: 2, col: "x" });
    expect(s.size()).toBe(3);
    expect(s.has({ row: 0, col: "x" })).toBe(true);
    expect(s.has({ row: 1, col: "y" })).toBe(true);
    expect(s.has({ row: 2, col: "x" })).toBe(true);
  });

  it("cmd-click toggles already-selected cell off", () => {
    const s = new CellSelection({
      filledKeys: new Set<string>(),
      rowCount: 3,
      cols: ["x"],
    });
    s.click({ row: 0, col: "x" });
    s.cmdClick({ row: 1, col: "x" });
    expect(s.size()).toBe(2);
    s.cmdClick({ row: 1, col: "x" });
    expect(s.size()).toBe(1);
    expect(s.has({ row: 0, col: "x" })).toBe(true);
    expect(s.has({ row: 1, col: "x" })).toBe(false);
  });

  it("cmd-click on filled cell is a no-op", () => {
    const s = new CellSelection({
      filledKeys: new Set(["1:x"]),
      rowCount: 3,
      cols: ["x"],
    });
    s.click({ row: 0, col: "x" });
    s.cmdClick({ row: 1, col: "x" });
    expect(s.size()).toBe(1);
    expect(s.has({ row: 1, col: "x" })).toBe(false);
  });

  it("clickRow selects all empty cells in row", () => {
    const s = new CellSelection({
      filledKeys: new Set(["0:x"]),
      rowCount: 1,
      cols: ["x", "y", "z"],
    });
    s.clickRow(0);
    expect(s.list().sort((a, b) => a.col.localeCompare(b.col))).toEqual([
      { row: 0, col: "y" },
      { row: 0, col: "z" },
    ]);
  });

  it("clickCol selects all empty cells in column", () => {
    const s = new CellSelection({
      filledKeys: new Set(["1:x"]),
      rowCount: 3,
      cols: ["x", "y"],
    });
    s.clickCol("x");
    expect(s.list().sort((a, b) => a.row - b.row)).toEqual([
      { row: 0, col: "x" },
      { row: 2, col: "x" },
    ]);
  });

  it("isEmpty returns true when zero empty cells selected", () => {
    const s = new CellSelection({
      filledKeys: new Set(["0:x"]),
      rowCount: 1,
      cols: ["x"],
    });
    expect(s.isEmpty()).toBe(true);
    s.click({ row: 0, col: "x" });
    expect(s.isEmpty()).toBe(true);
  });

  it("shiftClick without anchor falls back to click", () => {
    const s = new CellSelection({
      filledKeys: new Set<string>(),
      rowCount: 3,
      cols: ["x"],
    });
    s.shiftClick({ row: 1, col: "x" });
    expect(s.list()).toEqual([{ row: 1, col: "x" }]);
  });
});
