export interface FolderRow {
  id: string;
  parentId: string | null;
  name: string;
  isTrash: boolean;
}

export function isDescendantOf(
  all: FolderRow[],
  ancestorId: string,
  candidateId: string,
): boolean {
  const byId = new Map(all.map((f) => [f.id, f]));
  let cur: string | null = candidateId;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function resolveChain(
  all: FolderRow[],
  leafId: string | null,
): FolderRow[] {
  if (!leafId) return [];
  const byId = new Map(all.map((f) => [f.id, f]));
  const chain: FolderRow[] = [];
  let cur: string | null = leafId;
  while (cur) {
    const f = byId.get(cur);
    if (!f) break;
    chain.push(f);
    cur = f.parentId;
  }
  return chain.reverse();
}

export function breadcrumbFromChain(chain: FolderRow[]): string {
  return chain.map((f) => f.name).join(" / ");
}

export function normalizeFolderName(raw: string): string {
  return raw.trim();
}

export function validateFolderName(raw: string): string | null {
  const n = normalizeFolderName(raw);
  if (n.length === 0) return "Name is required";
  if (n.includes("/")) return "Slashes are not allowed in folder names";
  if (n.toLowerCase() === "trash") return "'Trash' is reserved";
  if (n.length > 200) return "Name too long";
  return null;
}
