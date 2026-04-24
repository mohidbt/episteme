import { describe, it, expect } from "vitest";
import { buildFolderTree, type TreeItem } from "./tree";

type FolderFixture = {
  id: string;
  name: string;
  parentId: string | null;
  isTrash: boolean;
  sortOrder?: number;
};

describe("buildFolderTree", () => {
  it("returns empty root when given no folders and no items", () => {
    const tree = buildFolderTree([], []);
    expect(tree.folder).toBeNull();
    expect(tree.path).toBe("");
    expect(tree.items).toEqual([]);
    expect(tree.children).toEqual([]);
  });

  it("builds a nested tree from folder rows", () => {
    const folders: FolderFixture[] = [
      { id: "a", name: "A", parentId: null, isTrash: false, sortOrder: 0 },
      { id: "b", name: "B", parentId: "a", isTrash: false, sortOrder: 0 },
      { id: "c", name: "C", parentId: "b", isTrash: false, sortOrder: 0 },
    ];
    const tree = buildFolderTree(folders, []);

    expect(tree.children).toHaveLength(1);
    const a = tree.children[0];
    expect(a.folder?.id).toBe("a");
    expect(a.path).toBe("A/");

    expect(a.children).toHaveLength(1);
    const b = a.children[0];
    expect(b.folder?.id).toBe("b");
    expect(b.path).toBe("A/B/");

    expect(b.children).toHaveLength(1);
    const c = b.children[0];
    expect(c.folder?.id).toBe("c");
    expect(c.path).toBe("A/B/C/");
  });

  it("excludes trash folders by default", () => {
    const folders: FolderFixture[] = [
      { id: "a", name: "A", parentId: null, isTrash: false, sortOrder: 0 },
      { id: "t", name: "Trash", parentId: null, isTrash: true, sortOrder: 99 },
    ];
    const tree = buildFolderTree(folders, []);
    expect(tree.children.map((c) => c.folder?.id)).toEqual(["a"]);
  });

  it("includes trash folders when includeTrash is true", () => {
    const folders: FolderFixture[] = [
      { id: "a", name: "A", parentId: null, isTrash: false, sortOrder: 0 },
      { id: "t", name: "Trash", parentId: null, isTrash: true, sortOrder: 99 },
    ];
    const tree = buildFolderTree(folders, [], { includeTrash: true });
    expect(tree.children.map((c) => c.folder?.id)).toEqual(["a", "t"]);
  });

  it("excludes descendants of a trash folder by default", () => {
    const folders: FolderFixture[] = [
      { id: "t", name: "Trash", parentId: null, isTrash: true, sortOrder: 0 },
      { id: "x", name: "X", parentId: "t", isTrash: false, sortOrder: 0 },
    ];
    const tree = buildFolderTree(folders, []);
    expect(tree.children).toEqual([]);
  });

  it("attaches items by folderId at the matching node", () => {
    const folders: FolderFixture[] = [
      { id: "a", name: "A", parentId: null, isTrash: false, sortOrder: 0 },
      { id: "b", name: "B", parentId: "a", isTrash: false, sortOrder: 0 },
    ];
    const items: TreeItem[] = [
      { id: "p1", title: "at-a", folderId: "a", kind: "paper" },
      { id: "p2", title: "at-b", folderId: "b", kind: "note" },
    ];
    const tree = buildFolderTree(folders, items);
    const a = tree.children[0];
    const b = a.children[0];
    expect(a.items.map((i) => i.id)).toEqual(["p1"]);
    expect(b.items.map((i) => i.id)).toEqual(["p2"]);
    expect(tree.items).toEqual([]);
  });

  it("attaches items with folderId=null at the root node", () => {
    const items: TreeItem[] = [
      { id: "n1", title: "root-note", folderId: null, kind: "note" },
    ];
    const tree = buildFolderTree([], items);
    expect(tree.items.map((i) => i.id)).toEqual(["n1"]);
  });

  it("treats items with an unknown folderId as orphans at the root", () => {
    const folders: FolderFixture[] = [
      { id: "a", name: "A", parentId: null, isTrash: false, sortOrder: 0 },
    ];
    const items: TreeItem[] = [
      { id: "orphan", title: "lost", folderId: "missing", kind: "paper" },
      { id: "normal", title: "normal", folderId: "a", kind: "paper" },
    ];
    const tree = buildFolderTree(folders, items);
    expect(tree.items.map((i) => i.id)).toEqual(["orphan"]);
    expect(tree.children[0].items.map((i) => i.id)).toEqual(["normal"]);
  });

  it("drops items whose folder is inside a trash subtree (when trash excluded)", () => {
    const folders: FolderFixture[] = [
      { id: "t", name: "Trash", parentId: null, isTrash: true, sortOrder: 0 },
    ];
    const items: TreeItem[] = [
      { id: "p1", title: "gone", folderId: "t", kind: "paper" },
    ];
    const tree = buildFolderTree(folders, items);
    expect(tree.children).toEqual([]);
    expect(tree.items).toEqual([]);
  });

  it("sorts folder children by (sortOrder asc, name asc)", () => {
    const folders: FolderFixture[] = [
      { id: "z", name: "Zeta", parentId: null, isTrash: false, sortOrder: 0 },
      { id: "a", name: "apple", parentId: null, isTrash: false, sortOrder: 0 },
      { id: "b", name: "Beta", parentId: null, isTrash: false, sortOrder: -5 },
      { id: "c", name: "carrot", parentId: null, isTrash: false, sortOrder: 10 },
    ];
    const tree = buildFolderTree(folders, []);
    expect(tree.children.map((c) => c.folder?.id)).toEqual(["b", "a", "z", "c"]);
  });

  it("sorts items by title case-insensitive with stable order for ties/nulls", () => {
    const items: TreeItem[] = [
      { id: "1", title: "banana", folderId: null, kind: "note" },
      { id: "2", title: null, folderId: null, kind: "note" },
      { id: "3", title: "Apple", folderId: null, kind: "note" },
      { id: "4", title: null, folderId: null, kind: "note" },
    ];
    const tree = buildFolderTree([], items);
    expect(tree.items.map((i) => i.id)).toEqual(["3", "1", "2", "4"]);
  });
});
