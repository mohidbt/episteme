import {
  StickyNote,
  FileText,
  BookMarked,
  Image,
  Table2,
  Folder,
  NotebookPen,
  Network,
  MessagesSquare,
  UserCog,
  Database,
  Palette,
  ShieldCheck,
  Cog,
  Trash2,
  Tag,
  type LucideIcon,
} from "lucide-react";

export type FileTypeKind =
  | "note"
  | "notes-list"
  | "paper"
  | "reference"
  | "asset"
  | "paperset"
  | "agent"
  | "drive"
  | "graph"
  | "trash"
  | "tag"
  | "settings"
  | "settings-account"
  | "settings-data"
  | "settings-appearance"
  | "settings-agents";

/**
 * Map a drive-item or sidebar-route kind to the Lucide icon used in the tab
 * bar and Drive tree. Keep the kind set in sync with sidebar icon choices
 * in `components/ByTypeNav.tsx`, `SidebarSettingsSection.tsx`, and
 * `SidebarAgentSection.tsx`.
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
      return MessagesSquare;
    case "drive":
      return Folder;
    case "notes-list":
      return NotebookPen;
    case "graph":
      return Network;
    case "trash":
      return Trash2;
    case "tag":
      return Tag;
    case "settings-account":
      return UserCog;
    case "settings-data":
      return Database;
    case "settings-appearance":
      return Palette;
    case "settings-agents":
      return ShieldCheck;
    case "settings":
      return Cog;
    case "note":
      return NotebookPen;
    default:
      return StickyNote;
  }
}

/**
 * Infer the file-type kind from an internal href. Tabs only have an href
 * to work with, so the tab bar uses this to render the right icon next
 * to the title.
 *
 * Ordering matters: specific paths must be checked before generic prefixes
 * (e.g. `/settings/account` before `/settings`, exact `/notes` before `/n/`).
 */
export function fileTypeKindFromHref(href: string): FileTypeKind | null {
  // Settings: specific subpages before generic /settings fallback
  if (href === "/settings/account" || href.startsWith("/settings/account/"))
    return "settings-account";
  if (href === "/settings/data" || href.startsWith("/settings/data/"))
    return "settings-data";
  if (
    href === "/settings/appearance" ||
    href.startsWith("/settings/appearance/")
  )
    return "settings-appearance";
  if (href === "/settings/agents" || href.startsWith("/settings/agents/"))
    return "settings-agents";
  if (href === "/settings" || href.startsWith("/settings")) return "settings";

  // Papersets: list page + detail page (/d/<id>)
  if (href.startsWith("/papersets") || href.startsWith("/d/")) return "paperset";
  if (href.startsWith("/agents")) return "agent";
  if (href.startsWith("/p/") || href.startsWith("/papers")) return "paper";
  if (href.startsWith("/r/") || href.startsWith("/references")) return "reference";
  // Exact /notes (list) before /n/<slug> (single note)
  if (href === "/notes" || href.startsWith("/notes/")) return "notes-list";
  if (href.startsWith("/n/")) return "note";
  if (href.startsWith("/graph")) return "graph";
  if (href.startsWith("/trash")) return "trash";
  if (href.startsWith("/tags")) return "tag";
  if (href === "/") return "drive";
  return null;
}
