/**
 * Pure folder-tree helpers for the KM sidebar.
 *
 * `folder_path` invariant: either '' (section root) or a non-empty string
 * ending in '/'. Segments are '/'-delimited. No leading slash.
 */

export type Section = "papers" | "references" | "notes";

export interface FolderNode<T> {
  folder: string;
  path: string;
  items: T[];
  children: FolderNode<T>[];
}

interface TreeItem {
  id: string | number;
  title: string | null;
  folder_path: string;
}

export function normalizeFolderPath(raw: string | null | undefined): string {
  if (raw == null) return "";
  const segments = raw.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return "";
  return segments.join("/") + "/";
}

export function splitFolderPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function compareTitles(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareFolders(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function buildFolderTree<T extends TreeItem>(items: T[]): FolderNode<T> {
  const root: FolderNode<T> = { folder: "", path: "", items: [], children: [] };

  for (const item of items) {
    const normalized = normalizeFolderPath(item.folder_path);
    const segments = splitFolderPath(normalized);
    let node = root;
    let pathAcc = "";
    for (const segment of segments) {
      pathAcc += segment + "/";
      let child = node.children.find((c) => c.folder === segment);
      if (!child) {
        child = { folder: segment, path: pathAcc, items: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.items.push(item);
  }

  const sortRecursively = (node: FolderNode<T>) => {
    // Stable sort: items by title (case-insensitive, nulls last, ties by id as input order)
    const indexed = node.items.map((it, idx) => ({ it, idx }));
    indexed.sort((a, b) => {
      const t = compareTitles(a.it.title, b.it.title);
      if (t !== 0) return t;
      return a.idx - b.idx;
    });
    node.items = indexed.map((e) => e.it);

    node.children.sort((a, b) => compareFolders(a.folder, b.folder));
    for (const child of node.children) sortRecursively(child);
  };

  sortRecursively(root);
  return root;
}

export interface MoveOpts {
  draggedSection: Section;
  targetSection: Section;
  currentFolderPath: string;
  targetFolderPath: string;
  draggedKind: "leaf" | "folder";
  draggedFolderPath?: string;
}

export function computeMovePatch(opts: MoveOpts): { folder_path: string } | null {
  if (opts.draggedSection !== opts.targetSection) return null;

  const target = normalizeFolderPath(opts.targetFolderPath);
  const current = normalizeFolderPath(opts.currentFolderPath);

  if (opts.draggedKind === "folder") {
    const dragged = normalizeFolderPath(opts.draggedFolderPath);
    // Cycle protection: dropping folder on itself or into any descendant.
    if (dragged !== "" && target.startsWith(dragged)) return null;
    // No-op: target equals the folder's current parent (we're not actually moving).
    // The caller handles folder moves via computeFolderRename; this function
    // only answers "is the drop legal?" — returning a patch object signals yes.
    if (target === current) return null;
    return { folder_path: target };
  }

  if (target === current) return null;
  return { folder_path: target };
}

export interface FolderRenameOpts {
  currentFolderPath: string;
  newParentPath: string;
  newFolderName?: string;
}

export function computeFolderRename(
  opts: FolderRenameOpts,
): { oldPrefix: string; newPrefix: string } | null {
  const oldPrefix = normalizeFolderPath(opts.currentFolderPath);
  if (oldPrefix === "") return null;

  const parent = normalizeFolderPath(opts.newParentPath);
  const currentSegments = splitFolderPath(oldPrefix);
  const lastSegment = currentSegments[currentSegments.length - 1];
  const rawName = opts.newFolderName ?? lastSegment;
  const nameSegments = splitFolderPath(rawName);
  if (nameSegments.length === 0) return null;

  const newPrefix = normalizeFolderPath(parent + nameSegments.join("/"));

  if (newPrefix === oldPrefix) return null;
  // Cycle: moving/renaming a folder such that the new path sits inside the old.
  if (newPrefix.startsWith(oldPrefix)) return null;

  return { oldPrefix, newPrefix };
}
