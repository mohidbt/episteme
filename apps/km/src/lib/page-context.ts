/**
 * Pure helper that derives `PageContext` from a Next.js pathname.
 *
 * Mappings (first match wins):
 *   /p/:id        → { paperId }    // matches actual route /p/[paperId]
 *   /papers/:id   → { paperId }
 *   /n/:slug      → { noteId }     // matches actual route /n/[slug]
 *   /notes/:id    → { noteId }
 *   /datasets/:id → { datasetId }
 *   /folders/:id  → { folderId }
 *   else          → {}
 */

export interface PageContext {
  paperId?: string;
  noteId?: string;
  datasetId?: string;
  folderId?: string;
}

export function derivePageContext(pathname: string): PageContext {
  const segs = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (segs.length < 2) return {};
  const [head, id] = segs;
  if (!id) return {};
  switch (head) {
    case "p":
    case "papers":
      return { paperId: id };
    case "n":
    case "notes":
      return { noteId: id };
    case "datasets":
      return { datasetId: id };
    case "folders":
      return { folderId: id };
    default:
      return {};
  }
}
