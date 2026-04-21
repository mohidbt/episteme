"use client";

import { useState } from "react";

type Section = "notes" | "papers" | "references" | "all";

export function ExportControls({ libraryId }: { libraryId: number }) {
  const [section, setSection] = useState<Section>("all");

  return (
    <div className="flex items-center gap-2">
      <select
        value={section}
        onChange={(e) => setSection(e.target.value as Section)}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        aria-label="Export section"
      >
        <option value="all">All</option>
        <option value="notes">Notes</option>
        <option value="papers">Papers</option>
        <option value="references">References</option>
      </select>
      <a
        href={`/api/libraries/${libraryId}/export?section=${section}`}
        download
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background hover:bg-accent px-3 py-1.5 text-sm font-medium transition-colors"
      >
        Download
      </a>
    </div>
  );
}
