// GSD-96 R4 — Finder drop routing.
// Pure MIME / extension classifier for files dropped from Finder onto the
// chat composer. See plan §3.6 for routing table.
//
// Precedence (locked):
//   1. Extension is checked first when present + recognized. Files dropped
//      from Finder routinely arrive w/ blank `file.type` (.bib, .ris, plain
//      .md from many editors). Extension is the more reliable signal.
//   2. MIME used as fallback when extension is missing OR unknown.
//   3. Unknown ⇒ reject.

export type FinderRouteKind =
  | "paper"
  | "note"
  | "reference-bib"
  | "reference-ris"
  | "asset"
  | "reject";

export interface FinderRouteAction {
  kind: FinderRouteKind;
  reason?: string;
}

const REJECT_COPY = "We cannot process this file";

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

function getExt(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function routeFinderDrop(file: File): FinderRouteAction {
  const name = file.name ?? "";
  const mime = (file.type ?? "").toLowerCase();
  const ext = getExt(name);

  // Extension-first dispatch.
  switch (ext) {
    case "pdf":
      return { kind: "paper" };
    case "md":
    case "markdown":
      return { kind: "note" };
    case "bib":
      return { kind: "reference-bib" };
    case "ris":
      return { kind: "reference-ris" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return { kind: "asset" };
    case "csv":
      return { kind: "reject", reason: REJECT_COPY };
  }

  // MIME fallback (no recognized extension).
  if (mime === "application/pdf") return { kind: "paper" };
  if (mime === "text/markdown") return { kind: "note" };
  if (IMAGE_MIMES.has(mime)) return { kind: "asset" };
  if (mime === "text/csv") return { kind: "reject", reason: REJECT_COPY };

  return { kind: "reject", reason: REJECT_COPY };
}
