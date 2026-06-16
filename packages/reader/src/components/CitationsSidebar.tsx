"use client";

import { useState, useCallback, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Alert, AlertTitle } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { BookOpen, FileSearch, Loader2 } from "lucide-react";
import { CitationCard, type CitationWithStatus, type FolderOption } from "./CitationCard";
import { toast } from "sonner";

interface CitationsSidebarProps {
  paperId: string;
  open: boolean;
  citations: CitationWithStatus[];
  loading: boolean;
  /**
   * GSD-74 round 4: enrichment POST + polling are owned by the Reader parent
   * (see `useCitationEnrichment`). The sidebar surfaces enrichment-in-flight
   * via this flag and is otherwise a pure view.
   */
  enriching?: boolean;
  onExtracted?: () => void;
  onSaveToLibrary?: (citationId: number, folderId: string | null) => void;
  folders?: FolderOption[];
  dockControl?: ReactNode;
}

export function CitationsSidebar({
  paperId,
  open,
  citations,
  loading,
  enriching = false,
  onExtracted,
  onSaveToLibrary,
  folders = [],
  dockControl,
}: CitationsSidebarProps) {
  const [extracting, setExtracting] = useState(false);

  const handleExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const res = await fetch(`/api/papers/${paperId}/citations/extract`, {
        method: "POST",
        credentials: "include",
      });
      // GSD-124: align messaging with the /p/[id] "Find citations" button
      // (PaperActionsButtons) so the same backend response produces the same
      // user-visible outcome regardless of entry point.
      if (!res.ok) {
        toast.error("Citation extraction failed", { description: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        unavailable?: boolean;
        stats?: { referencesInserted?: number };
      };
      // The route degrades to 200 + { unavailable: true } when the upstream
      // PDF/agents service is unreachable. Surface that to the user instead
      // of silently calling onExtracted with an empty result.
      if (data?.unavailable) {
        toast.error("Citation extraction service is unavailable. Please try again later.");
        return;
      }
      const n = data.stats?.referencesInserted ?? 0;
      toast.success(n > 0 ? `Found ${n} citation${n === 1 ? "" : "s"}` : "No citations detected");
      onExtracted?.();
    } catch (err) {
      console.error("[citations-sidebar] extract error", err);
      toast.error("Citation extraction failed");
    } finally {
      setExtracting(false);
    }
  }, [paperId, onExtracted]);

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
            {citations.map((c) => {
              // D7.4 enrichment is appended by the citations API; tolerate
              // older payloads where these fields are absent.
              const extra = c as CitationWithStatus & {
                matchedPaperId?: string | null;
                citedInCount?: number;
                citingCount?: number;
              };
              return (
                <CitationCard
                  key={c.id}
                  citation={c}
                  variant="compact"
                  onSaveToLibrary={onSaveToLibrary ? (folderId) => onSaveToLibrary(c.id, folderId) : undefined}
                  folders={folders}
                  matchedPaperId={extra.matchedPaperId ?? null}
                  citedInCount={extra.citedInCount ?? 0}
                  citingCount={extra.citingCount ?? 0}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
