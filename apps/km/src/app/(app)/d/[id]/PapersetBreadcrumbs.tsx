import { PathPill, type PathPillSegment } from "@/components/PathPill";
import type { FolderChainEntry } from "./lib/folder-chain";

interface Props {
  libraryName: string | null;
  folderChain: FolderChainEntry[];
  filename: string;
}

/**
 * Breadcrumbs for the paperset viewer. Mirrors the shape used by /p/[paperId]:
 *   Library · folder chain · filename
 *
 * Folder hrefs route into /drive/<folder-id> (where the FileBrowser lives).
 * If the library hasn't loaded (anon edge case) we render nothing — same
 * defensive guard as the paper page.
 */
export function PapersetBreadcrumbs({ libraryName, folderChain, filename }: Props) {
  if (!libraryName) return null;
  const segments: PathPillSegment[] = [
    { id: "root", label: libraryName, href: "/" },
    ...folderChain.map((f, i) => ({
      id: `folder-${f.id}`,
      label: f.name,
      href:
        "/drive/" +
        folderChain
          .slice(0, i + 1)
          .map((x) => encodeURIComponent(x.name))
          .join("/"),
    })),
    { id: "filename", label: filename, href: null },
  ];
  return <PathPill className="mb-4" segments={segments} />;
}
