import { PaperCard } from "@/components/PaperCard";
import type { PaperRow } from "@/lib/papers-server";

interface PaperGridProps {
  papers: PaperRow[];
}

export function PaperGrid({ papers }: PaperGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
      {papers.map((p) => (
        <PaperCard
          key={p.id}
          id={p.id}
          title={p.title}
          filename={p.filename}
          authors={p.authors}
          year={p.year}
        />
      ))}
    </div>
  );
}
