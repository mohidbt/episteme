"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, FileSearch, Loader2 } from "lucide-react";
import { CitationCard, type CitationWithStatus } from "@/components/reader/citation-card";
import { toast } from "sonner";

interface CitationsSidebarProps {
  documentId: number;
  open: boolean;
  citations: CitationWithStatus[];
  loading: boolean;
  onExtracted?: () => void;
  dockControl?: ReactNode;
}

export function CitationsSidebar({ documentId, open, citations, loading, onExtracted, dockControl }: CitationsSidebarProps) {
  const [extracting, setExtracting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const enrichFiredRef = useRef(false);
  // Keep latest callback in a ref so the enrich effect doesn't need it as a dep.
  // Including an inline onExtracted in deps re-runs the effect on every parent
  // render, causing double-fire of the enrich POST.
  const onExtractedRef = useRef(onExtracted);
  useEffect(() => { onExtractedRef.current = onExtracted; });

  // Reset enrich gate when document changes
  useEffect(() => {
    enrichFiredRef.current = false;
  }, [documentId]);

  // Auto-enrich once per session open when any ref lacks semanticScholarId
  useEffect(() => {
    if (!open || citations.length === 0) return;
    if (!citations.some((r) => !r.semanticScholarId)) return;
    if (enrichFiredRef.current) return;

    enrichFiredRef.current = true;
    const controller = new AbortController();
    setEnriching(true);

    fetch(`/api/documents/${documentId}/citations/enrich`, { method: "POST", signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`enrich failed: ${res.status}`);
        return res.json();
      })
      .then(() => {
        onExtractedRef.current?.();
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error("[citations-sidebar] enrich error", err);
        toast.error("Enrichment failed. Citations shown with available data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setEnriching(false);
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, citations, documentId]);

  const handleExtract = useCallback(async () => {
    setExtracting(true);
    try {
      await fetch(`/api/documents/${documentId}/citations/extract`, { method: "POST" });
      onExtracted?.();
    } finally {
      setExtracting(false);
    }
  }, [documentId, onExtracted]);

  if (!open) return null;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">Citations</h2>
        {dockControl}
      </div>
      {enriching && (
        <Alert className="rounded-none border-x-0 border-t-0 px-4">
          <BookOpen />
          <AlertTitle>Enriching from Semantic Scholar…</AlertTitle>
        </Alert>
      )}
      <div className="flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {!loading && citations.length === 0 && (
          <div className="flex flex-col gap-2">
            <FileSearch className="text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium text-muted-foreground">No citations detected</p>
            <p className="text-xs text-muted-foreground/70">
              This document may use a citation format not yet supported.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={extracting}
              onClick={handleExtract}
            >
              {extracting ? (
                <>
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                  Extracting…
                </>
              ) : (
                "Extract Citations"
              )}
            </Button>
          </div>
        )}
        {!loading && citations.length > 0 && (
          <div className="flex flex-col gap-2">
            {citations.map((c) => (
              <CitationCard key={c.id} citation={c} variant="compact" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
