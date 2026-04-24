import { PaperCard } from "@/components/PaperCard";
import { FolderBreadcrumbBadge } from "@/components/FolderBreadcrumbBadge";
import type { PaperRow } from "@/lib/papers-server";
import type { FolderRow } from "@/lib/folders";

interface PaperGridProps {
  papers: PaperRow[];
  folders?: FolderRow[];
}

export function PaperGrid({ papers, folders }: PaperGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {papers.map((p) => (
        <div key={p.id} className="flex flex-col gap-1.5">
          <PaperCard
            id={p.id}
            title={p.title}
            filename={p.filename}
            authors={p.authors}
            year={p.year}
          />
          {folders && p.folderId && (
            <FolderBreadcrumbBadge folderId={p.folderId} folders={folders} />
          )}
        </div>
      ))}
    </div>
  );
}
