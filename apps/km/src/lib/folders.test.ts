import { describe, it, expect } from "vitest";
import {
  isDescendantOf,
  isHiddenFolder,
  resolveChain,
  breadcrumbFromChain,
  normalizeFolderName,
  validateFolderName,
  type FolderRow,
} from "./folders";

const mk = (id: string, parent: string | null, name: string): FolderRow =>
  ({ id, parentId: parent, name, isTrash: false });

const A = mk("A", null, "A");
const B = mk("B", "A", "B");
const C = mk("C", "B", "C");
const T = { ...mk("T", null, "Trash"), isTrash: true };

const all = [A, B, C, T];

describe("isDescendantOf", () => {
  it("returns true when the target is self", () => {
    expect(isDescendantOf(all, "A", "A")).toBe(true);
  });
  it("returns true for deep descendant", () => {
    expect(isDescendantOf(all, "A", "C")).toBe(true);
  });
  it("returns false for unrelated", () => {
    expect(isDescendantOf(all, "A", "T")).toBe(false);
  });
});

describe("resolveChain", () => {
  it("returns the ancestor chain root-to-leaf", () => {
    expect(resolveChain(all, "C").map((f) => f.id)).toEqual(["A", "B", "C"]);
  });
  it("returns [] for null", () => {
    expect(resolveChain(all, null)).toEqual([]);
  });
});

describe("breadcrumbFromChain", () => {
  it("joins names with /", () => {
    expect(breadcrumbFromChain([A, B, C])).toBe("A / B / C");
  });
});

describe("isHiddenFolder", () => {
  const E = mk("E", null, ".episteme");
  const M = mk("M", "E", "memories");
  const N = mk("N", "M", "research");
  const tree = [A, B, C, E, M, N];

  it("returns true for the .episteme folder itself", () => {
    expect(isHiddenFolder(tree, "E")).toBe(true);
  });
  it("returns true for a descendant of .episteme", () => {
    expect(isHiddenFolder(tree, "N")).toBe(true);
  });
  it("returns false for unrelated folder", () => {
    expect(isHiddenFolder(tree, "C")).toBe(false);
  });
  it("returns false for null", () => {
    expect(isHiddenFolder(tree, null)).toBe(false);
  });
});

describe("validateFolderName", () => {
  it("rejects empty", () => {
    expect(validateFolderName("")).toMatch(/required/i);
  });
  it("rejects /", () => {
    expect(validateFolderName("a/b")).toMatch(/slash/i);
  });
  it("rejects 'Trash' case-insensitively", () => {
    expect(validateFolderName("trash")).toMatch(/reserved/i);
  });
  it("accepts normal name", () => {
    expect(validateFolderName("Papers 2026")).toBeNull();
  });
});
