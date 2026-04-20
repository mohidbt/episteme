import { describe, it, expect } from "vitest";
import {
  normalizeFolderPath,
  splitFolderPath,
  buildFolderTree,
  computeMovePatch,
  computeFolderRename,
} from "./tree";

describe("splitFolderPath", () => {
  it("returns [] for empty string", () => {
    expect(splitFolderPath("")).toEqual([]);
  });

  it("splits a normalized folder path", () => {
    expect(splitFolderPath("projects/phd/")).toEqual(["projects", "phd"]);
  });

  it("drops empty segments from repeated slashes", () => {
    expect(splitFolderPath("a//b/")).toEqual(["a", "b"]);
  });

  it("ignores leading and trailing slashes", () => {
    expect(splitFolderPath("/foo/bar")).toEqual(["foo", "bar"]);
  });
});

describe("normalizeFolderPath", () => {
  it("coerces null to ''", () => {
    expect(normalizeFolderPath(null)).toBe("");
  });

  it("coerces undefined to ''", () => {
    expect(normalizeFolderPath(undefined)).toBe("");
  });

  it("appends trailing slash", () => {
    expect(normalizeFolderPath("inbox")).toBe("inbox/");
  });

  it("strips leading slashes and collapses repeats", () => {
    expect(normalizeFolderPath("/a//b")).toBe("a/b/");
  });

  it("leaves '' as ''", () => {
    expect(normalizeFolderPath("")).toBe("");
  });

  it("treats a path of only slashes as root", () => {
    expect(normalizeFolderPath("///")).toBe("");
  });
});

describe("buildFolderTree", () => {
  it("returns empty root on empty input", () => {
    expect(buildFolderTree([])).toEqual({
      folder: "",
      path: "",
      items: [],
      children: [],
    });
  });

  it("nests items by folder, sorts folders alpha, items at correct nodes", () => {
    const items = [
      { id: 1, title: "a", folder_path: "" },
      { id: 2, title: "b", folder_path: "inbox/" },
      { id: 3, title: "c", folder_path: "projects/phd/" },
    ];
    const tree = buildFolderTree(items);

    expect(tree.folder).toBe("");
    expect(tree.path).toBe("");
    expect(tree.items.map((i) => i.id)).toEqual([1]);
    expect(tree.children.map((c) => c.folder)).toEqual(["inbox", "projects"]);

    const inbox = tree.children[0];
    expect(inbox.path).toBe("inbox/");
    expect(inbox.items.map((i) => i.id)).toEqual([2]);
    expect(inbox.children).toEqual([]);

    const projects = tree.children[1];
    expect(projects.path).toBe("projects/");
    expect(projects.items).toEqual([]);
    expect(projects.children).toHaveLength(1);

    const phd = projects.children[0];
    expect(phd.folder).toBe("phd");
    expect(phd.path).toBe("projects/phd/");
    expect(phd.items.map((i) => i.id)).toEqual([3]);
  });

  it("sorts folders alphabetically case-insensitive", () => {
    const tree = buildFolderTree([
      { id: 1, title: "x", folder_path: "Zeta/" },
      { id: 2, title: "y", folder_path: "apple/" },
      { id: 3, title: "z", folder_path: "Beta/" },
    ]);
    expect(tree.children.map((c) => c.folder)).toEqual(["apple", "Beta", "Zeta"]);
  });

  it("sorts items in a folder by title case-insensitive, nulls last", () => {
    const tree = buildFolderTree([
      { id: 1, title: "banana", folder_path: "" },
      { id: 2, title: null, folder_path: "" },
      { id: 3, title: "Apple", folder_path: "" },
      { id: 4, title: null, folder_path: "" },
    ]);
    expect(tree.items.map((i) => i.id)).toEqual([3, 1, 2, 4]);
  });

  it("normalizes non-slashed folder_path input", () => {
    const tree = buildFolderTree([{ id: 1, title: "a", folder_path: "inbox" }]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].path).toBe("inbox/");
    expect(tree.children[0].items.map((i) => i.id)).toEqual([1]);
  });
});

describe("computeMovePatch", () => {
  it("moves a leaf across folders in the same section", () => {
    expect(
      computeMovePatch({
        draggedSection: "notes",
        targetSection: "notes",
        currentFolderPath: "",
        targetFolderPath: "inbox/",
        draggedKind: "leaf",
      }),
    ).toEqual({ folder_path: "inbox/" });
  });

  it("returns null for same-section no-op", () => {
    expect(
      computeMovePatch({
        draggedSection: "notes",
        targetSection: "notes",
        currentFolderPath: "inbox/",
        targetFolderPath: "inbox/",
        draggedKind: "leaf",
      }),
    ).toBeNull();
  });

  it("returns null for cross-section drops", () => {
    expect(
      computeMovePatch({
        draggedSection: "notes",
        targetSection: "papers",
        currentFolderPath: "",
        targetFolderPath: "inbox/",
        draggedKind: "leaf",
      }),
    ).toBeNull();
  });

  it("returns null when dropping a folder into its own descendant", () => {
    expect(
      computeMovePatch({
        draggedSection: "notes",
        targetSection: "notes",
        currentFolderPath: "projects/",
        targetFolderPath: "projects/phd/",
        draggedKind: "folder",
        draggedFolderPath: "projects/",
      }),
    ).toBeNull();
  });

  it("returns null when folder is dropped on itself", () => {
    expect(
      computeMovePatch({
        draggedSection: "notes",
        targetSection: "notes",
        currentFolderPath: "projects/",
        targetFolderPath: "projects/",
        draggedKind: "folder",
        draggedFolderPath: "projects/",
      }),
    ).toBeNull();
  });

  it("normalizes the target folder_path on return", () => {
    expect(
      computeMovePatch({
        draggedSection: "notes",
        targetSection: "notes",
        currentFolderPath: "",
        targetFolderPath: "inbox",
        draggedKind: "leaf",
      }),
    ).toEqual({ folder_path: "inbox/" });
  });
});

describe("computeFolderRename", () => {
  it("renames a root-level folder", () => {
    expect(
      computeFolderRename({
        currentFolderPath: "deep-learning/",
        newParentPath: "",
        newFolderName: "dl",
      }),
    ).toEqual({ oldPrefix: "deep-learning/", newPrefix: "dl/" });
  });

  it("returns null when the rename would form a cycle", () => {
    expect(
      computeFolderRename({
        currentFolderPath: "projects/",
        newParentPath: "projects/phd/",
      }),
    ).toBeNull();
  });

  it("returns null when rename is a no-op", () => {
    expect(
      computeFolderRename({
        currentFolderPath: "deep-learning/",
        newParentPath: "",
        newFolderName: "deep-learning",
      }),
    ).toBeNull();
  });

  it("moves a folder under a new parent, keeping last segment", () => {
    expect(
      computeFolderRename({
        currentFolderPath: "deep-learning/",
        newParentPath: "archive/",
      }),
    ).toEqual({ oldPrefix: "deep-learning/", newPrefix: "archive/deep-learning/" });
  });

  it("rewrites descendant folder_paths when applied as a DB REPLACE", () => {
    // Regression: simulate the UPDATE ... REPLACE(folder_path, oldPrefix, newPrefix) WHERE folder_path LIKE oldPrefix||'%'
    const patch = computeFolderRename({
      currentFolderPath: "deep-learning/",
      newParentPath: "",
      newFolderName: "dl",
    })!;
    const rewrite = (fp: string) =>
      fp.startsWith(patch.oldPrefix)
        ? patch.newPrefix + fp.slice(patch.oldPrefix.length)
        : fp;
    expect(rewrite("deep-learning/cnn/")).toBe("dl/cnn/");
    expect(rewrite("deep-learning/")).toBe("dl/");
    expect(rewrite("other/")).toBe("other/");
  });
});
