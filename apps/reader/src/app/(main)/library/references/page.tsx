"use client";

import { useState, useEffect } from "react";
import { CitationCard } from "@/components/reader/citation-card";
import type { CitationWithStatus } from "@/components/reader/citation-card";
import type { InferSelectModel } from "drizzle-orm";
import type { libraryReferences } from "@episteme/db/schema";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type LibraryRef = InferSelectModel<typeof libraryReferences>;

function toCardCitation(ref: LibraryRef): CitationWithStatus {
  return {
    // Required DocumentReference fields not on library refs — provide neutral defaults
    id: ref.id,
    documentId: 0,
    markerText: ref.title,
    markerIndex: 0,
    rawText: null,
    pageNumber: null,
    // Shared fields
    title: ref.title,
    authors: ref.authors ?? null,
    year: ref.year,
    doi: ref.doi,
    url: ref.url,
    semanticScholarId: ref.semanticScholarId,
    abstract: ref.abstract,
    venue: ref.venue,
    citationCount: ref.citationCount,
    createdAt: ref.createdAt,
    // Phase 2.2 enrichment fields
    influentialCitationCount: ref.influentialCitationCount,
    openAccessPdfUrl: ref.openAccessPdfUrl,
    tldrText: ref.tldrText,
    externalIds: ref.externalIds,
    bibtex: ref.bibtex,
    // Library-specific status (already saved)
    keptId: null,
    libraryReferenceId: ref.id,
  };
}

export default function ReferencesPage() {
  const [refs, setRefs] = useState<LibraryRef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/library/references")
      .then((r) => r.json())
      .then((data: LibraryRef[]) => setRefs(data))
      .catch(() => toast.error("Failed to load references"))
      .finally(() => setLoading(false));
  }, []);

  async function handleRemove(id: number) {
    if (!window.confirm("Remove this reference from your library?")) return;

    const prev = refs;
    setRefs((r) => r.filter((x) => x.id !== id));

    try {
      const res = await fetch(`/api/library/references/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch {
      setRefs(prev);
      toast.error("Failed to remove reference");
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-semibold mb-6">Saved References</h1>
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-semibold mb-6">Saved References</h1>

      {refs.length === 0 ? (
        <div className="mt-12 text-center text-muted-foreground">
          <p className="text-lg">No saved references yet.</p>
          <p className="text-sm mt-1">
            Click a citation in a paper and use &ldquo;Save to Library&rdquo;.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {refs.map((ref) => (
            <CitationCard
              key={ref.id}
              citation={toCardCitation(ref)}
              variant="compact"
              headerAction={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleRemove(ref.id)}
                  className="h-7 rounded-full px-2.5 text-xs hover:text-destructive hover:border-destructive"
                  aria-label="Remove from library"
                >
                  Remove
                </Button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
