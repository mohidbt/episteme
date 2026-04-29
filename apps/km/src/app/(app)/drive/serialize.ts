import type { FolderContents } from "@/lib/folders-server";

/**
 * Convert every `updatedAt: Date` inside a FolderContents value to a numeric
 * epoch-ms so the blob is safe to cross the RSC → Client Component boundary.
 */
export function serializeFolderContents(c: FolderContents): FolderContents {
  const toMs = (d: Date | number | string): number =>
    d instanceof Date ? d.getTime() : typeof d === "number" ? d : new Date(d).getTime();
  return {
    folders: c.folders.map((f) => ({ ...f, updatedAt: toMs(f.updatedAt) })),
    papers: c.papers.map((p) => ({ ...p, updatedAt: toMs(p.updatedAt) })),
    references: c.references.map((r) => ({ ...r, updatedAt: toMs(r.updatedAt) })),
    notes: c.notes.map((n) => ({ ...n, updatedAt: toMs(n.updatedAt) })),
    assets: c.assets.map((a) => ({ ...a, updatedAt: toMs(a.updatedAt) })),
    papersets: c.papersets.map((p) => ({ ...p, updatedAt: toMs(p.updatedAt) })),
  };
}
