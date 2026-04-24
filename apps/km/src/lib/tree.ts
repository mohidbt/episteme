/**
 * Folder-tree builder for the KM sidebar.
 *
 * Builds a tree from `folders` rows + typed items carrying `folderId`.
 * Legacy `folder_path` string helpers retained below as deprecated shims —
 * they still power `/api/folders/delete|rename` + Breadcrumbs until those
 * call sites are rewritten in a later task.
 */

export type Section = "papers" | "references" | "notes";

export interface TreeItem {
  id: string;
  title: string | null;
  folderId: string | null;
  kind: "paper" | "reference" | "note";
}

export interface FolderNode {
  folder: { id: string; name: string; isTrash: boolean } | null; // null = library root
  path: string; // "" for root, else "A/B/" — derived from name chain
  items: TreeItem[];
  children: FolderNode[];
}

interface FolderRowInput {
  id: string;
  name: string;
  parentId: string | null;
  isTrash: boolean;
  sortOrder?: number;
}

function compareTitles(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareFolders(
  a: { sortOrder: number; name: string },
  b: { sortOrder: number; name: string },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function buildFolderTree(
  folders: FolderRowInput[],
  items: TreeItem[],
  opts?: { includeTrash?: boolean },
): FolderNode {
  const includeTrash = opts?.includeTrash ?? false;

  // Map folders by id, stamp sortOrder default.
  const normFolders = folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    isTrash: f.isTrash,
    sortOrder: f.sortOrder ?? 0,
  }));
  const byId = new Map(normFolders.map((f) => [f.id, f]));

  // Compute the set of folder ids excluded (trash-flagged, or any descendant).
  const excluded = new Set<string>();
  if (!includeTrash) {
    // Seed with all trash-flagged.
    for (const f of normFolders) if (f.isTrash) excluded.add(f.id);
    // Propagate down via ancestor walk: any folder whose chain hits an excluded ancestor is also excluded.
    for (const f of normFolders) {
      if (excluded.has(f.id)) continue;
      let cur: string | null = f.parentId;
      while (cur) {
        if (excluded.has(cur)) {
          excluded.add(f.id);
          break;
        }
        cur = byId.get(cur)?.parentId ?? null;
      }
    }
  }

  // Build path for each included folder (chain of names).
  const pathById = new Map<string, string>();
  const buildPath = (id: string): string => {
    const cached = pathById.get(id);
    if (cached !== undefined) return cached;
    const f = byId.get(id);
    if (!f) return "";
    const parentPath = f.parentId ? buildPath(f.parentId) : "";
    const p = parentPath + f.name + "/";
    pathById.set(id, p);
    return p;
  };

  // Create a FolderNode per included folder.
  const nodeById = new Map<string, FolderNode>();
  for (const f of normFolders) {
    if (excluded.has(f.id)) continue;
    nodeById.set(f.id, {
      folder: { id: f.id, name: f.name, isTrash: f.isTrash },
      path: buildPath(f.id),
      items: [],
      children: [],
    });
  }

  const root: FolderNode = { folder: null, path: "", items: [], children: [] };

  // Link parent → child.
  const childrenBuckets = new Map<string | null, { folder: typeof normFolders[number]; node: FolderNode }[]>();
  for (const f of normFolders) {
    if (excluded.has(f.id)) continue;
    const node = nodeById.get(f.id)!;
    const key = f.parentId && nodeById.has(f.parentId) ? f.parentId : null;
    const bucket = childrenBuckets.get(key);
    if (bucket) bucket.push({ folder: f, node });
    else childrenBuckets.set(key, [{ folder: f, node }]);
  }

  const attachChildren = (parentId: string | null, parentNode: FolderNode) => {
    const bucket = childrenBuckets.get(parentId) ?? [];
    bucket.sort((a, b) => compareFolders(a.folder, b.folder));
    parentNode.children = bucket.map((b) => b.node);
    for (const b of bucket) attachChildren(b.folder.id, b.node);
  };
  attachChildren(null, root);

  // Attach items.
  const indexedItems = items.map((it, idx) => ({ it, idx }));
  for (const { it } of indexedItems) {
    if (it.folderId === null) {
      root.items.push(it);
      continue;
    }
    const node = nodeById.get(it.folderId);
    if (node) {
      node.items.push(it);
    } else if (excluded.has(it.folderId)) {
      // Folder exists but is in an excluded (trash) subtree → drop the item.
      continue;
    } else {
      // Unknown folder id → orphan at root.
      root.items.push(it);
    }
  }

  // Sort items at every node, stable by original input order for ties.
  const sortItems = (node: FolderNode) => {
    const originalIndex = new Map(indexedItems.map(({ it, idx }) => [it, idx]));
    node.items = node.items
      .map((it) => ({ it, idx: originalIndex.get(it) ?? 0 }))
      .sort((a, b) => {
        const t = compareTitles(a.it.title, b.it.title);
        if (t !== 0) return t;
        return a.idx - b.idx;
      })
      .map((e) => e.it);
    for (const child of node.children) sortItems(child);
  };
  sortItems(root);

  return root;
}

// ---------------------------------------------------------------------------
// Legacy folder_path string helpers — DEPRECATED.
// Retained only so `/api/folders/delete|rename` and `Breadcrumbs.tsx`
// continue to compile until those surfaces are rewritten.
// TODO(0.12): remove once folder_path column is dropped.
// ---------------------------------------------------------------------------

export const FOLDER_PATH_FORBIDDEN = /[%_\\]/;

export function isValidFolderPath(raw: string): boolean {
  return !FOLDER_PATH_FORBIDDEN.test(raw);
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
