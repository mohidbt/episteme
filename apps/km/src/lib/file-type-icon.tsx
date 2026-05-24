import {
  StickyNote,
  FileText,
  BookMarked,
  Image,
  Table2,
  Hexagon,
  type LucideIcon,
} from "lucide-react";

export type FileTypeKind =
  | "note"
  | "paper"
  | "reference"
  | "asset"
  | "paperset"
  | "agent";

/**
 * Map a drive-item kind to the Lucide icon used in the tab bar and Drive tree.
 * Keep the kind set in sync with TreeItem["kind"] in `lib/tree.ts`.
 */
export function getFileTypeIcon(kind: FileTypeKind): LucideIcon {
  switch (kind) {
    case "paper":
      return FileText;
    case "reference":
      return BookMarked;
    case "asset":
      return Image;
    case "paperset":
      return Table2;
    case "agent":
      return Hexagon;
    case "note":
    default:
      return StickyNote;
  }
}

/**
 * Infer the file-type kind from an internal href. Tabs only have an href
 * to work with, so the tab bar uses this to render the right icon next
 * to the title.
 */
export function fileTypeKindFromHref(href: string): FileTypeKind | null {
  // Papersets: list page + detail page (/d/<id>)
  if (href.startsWith("/papersets") || href.startsWith("/d/")) return "paperset";
  if (href.startsWith("/agents")) return "agent";
  if (href.startsWith("/p/") || href.startsWith("/papers")) return "paper";
  if (href.startsWith("/r/") || href.startsWith("/references")) return "reference";
  if (href.startsWith("/n/") || href.startsWith("/notes")) return "note";
  return null;
}
