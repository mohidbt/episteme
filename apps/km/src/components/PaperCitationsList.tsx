"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  CitationCard,
  type CitationWithStatus,
  type FolderOption,
} from "@episteme/reader/citation-card";
import { Button } from "@/components/ui/button";
import {
  TrialExhaustedError,
  fetchOrThrowTrialExhausted,
  surfaceTrialExhaustedToast,
} from "@/lib/trial-exhausted";

interface PaperCitationsListProps {
  paperId: string;
}

type CitationRow = CitationWithStatus & {
  matchedPaperId?: string | null;
  citedInCount?: number;
  citingCount?: number;
  doi?: string | null;
  enrichedAt?: string | null;
};

interface CitationsResponse {
  citations: CitationRow[];
}

export function citationsRefreshEvent(paperId: string): string {
  return `paper-citations-refresh:${paperId}`;
}

// GSD-74: a ref is "unenriched" when `enrichedAt` is null AND it has a DOI to
// resolve against Semantic Scholar. Refs with no DOI cannot be enriched and
// must not trigger client polling. Enrichment is kicked off by the GET
// /citations route's `after()` hook and lands ~2-4s later (per-ref S2 lookup
// + batch fetch); we poll until every DOI-bearing ref has `enrichedAt` set.
function isUnenriched(row: CitationRow): boolean {
  return row.enrichedAt == null && row.doi != null && row.doi.length > 0;
}

// Polling cadence: 8s wait, then 6s × 5, then 12s × 6 → ~90s ceiling.
// Index 0 is the initial delay after the refresh event fires.
const POLL_DELAYS_MS = [8000, 6000, 6000, 6000, 6000, 6000, 12000, 12000, 12000, 12000, 12000, 12000];

export function PaperCitationsList({ paperId }: PaperCitationsListProps) {
  const [rows, setRows] = useState<CitationRow[] | null>(null);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [manualEnrichPending, setManualEnrichPending] = useState(false);
  const pendingIds = useRef<Set<number>>(new Set());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttempt = useRef(0);
  const mounted = useRef(true);

  const clearPoll = useCallback(() => {
    if (pollTimer.current != null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<CitationRow[] | null> => {
      try {
        const res = await fetch(`/api/papers/${paperId}/citations`, {
          credentials: "include",
          signal,
        });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return null;
        }
        const data = (await res.json()) as CitationsResponse;
        const next = data.citations ?? [];
        setError(null);
        setRows(next);
        return next;
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
        setError((e as Error).message);
        return null;
      }
    },
    [paperId],
  );

  // Poll loop: re-fetch citations after a backoff delay until every ref is
  // enriched or we hit the max-attempts ceiling.
  const scheduleNextPoll = useCallback(() => {
    if (!mounted.current) return;
    const attempt = pollAttempt.current;
    if (attempt >= POLL_DELAYS_MS.length) {
      setEnriching(false);
      return;
    }
    const delay = POLL_DELAYS_MS[attempt];
    pollAttempt.current = attempt + 1;
    pollTimer.current = setTimeout(async () => {
      pollTimer.current = null;
      if (!mounted.current) return;
      const next = await load();
      if (!mounted.current) return;
      if (next && next.some(isUnenriched)) {
        scheduleNextPoll();
      } else {
        setEnriching(false);
      }
    }, delay);
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearPoll();
    };
  }, [clearPoll]);

  // GSD-125: initial mount only loads citations. Enrichment polling no longer
  // auto-starts because GET is read-only — polling without a server-side S2
  // trigger would never converge. Polling starts only after the manual Enrich
  // button click (or the post-extract refresh event).
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    async function onRefresh() {
      setRefreshing(true);
      const next = await load();
      setRefreshing(false);
      if (next && next.some(isUnenriched)) {
        // Restart polling for the fresh extract.
        clearPoll();
        pollAttempt.current = 0;
        setEnriching(true);
        scheduleNextPoll();
      }
    }
    const evt = citationsRefreshEvent(paperId);
    window.addEventListener(evt, onRefresh);
    return () => window.removeEventListener(evt, onRefresh);
  }, [paperId, load, scheduleNextPoll, clearPoll]);

  // Folder picker source — mirrors Reader.tsx filter rules (hide Trash,
  // `.episteme/*`, and any `.`-prefixed system folder).
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/folders`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: {
        folders?: { id: string; name: string; parentId: string | null; isTrash: boolean }[];
      }) => {
        if (!Array.isArray(data?.folders)) return;
        const byId = new Map(data.folders.map((f) => [f.id, f]));
        const hiddenRoots = new Set<string>();
        for (const f of data.folders) {
          if (f.isTrash || f.name.startsWith(".")) hiddenRoots.add(f.id);
        }
        const isHidden = (id: string | null): boolean => {
          let cur = id;
          while (cur) {
            if (hiddenRoots.has(cur)) return true;
            cur = byId.get(cur)?.parentId ?? null;
          }
          return false;
        };
        const pathOf = (f: { id: string; name: string; parentId: string | null }): string => {
          const parts: string[] = [];
          let cur: string | null = f.id;
          while (cur) {
            const node = byId.get(cur);
            if (!node) break;
            parts.unshift(node.name);
            cur = node.parentId;
          }
          return parts.join(" / ");
        };
        const visible = data.folders
          .filter((f) => !isHidden(f.id))
          .map((f) => ({ id: f.id, name: f.name, path: pathOf(f) }))
          .sort((a, b) => a.path.localeCompare(b.path));
        setFolders(visible);
      })
      .catch(() => {/* non-fatal */});
    return () => ctl.abort();
  }, []);

  const patchCitation = useCallback((citationId: number, patch: Partial<CitationRow>) => {
    setRows((prev) => prev?.map((c) => (c.id === citationId ? { ...c, ...patch } : c)) ?? prev);
  }, []);

  const handleSave = useCallback(
    async (citationId: number, folderId: string | null) => {
      if (pendingIds.current.has(citationId)) return;
      pendingIds.current.add(citationId);
      try {
        const res = await fetch(`/api/papers/${paperId}/citations/${citationId}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(folderId ? { folderId } : {}),
        });
        if (res.ok) {
          const { keptId, libraryReferenceId } = (await res.json()) as {
            keptId: number;
            libraryReferenceId: number;
          };
          patchCitation(citationId, { keptId, libraryReferenceId });
          toast.success("Saved to library");
        } else {
          toast.error("Failed to save to library");
        }
      } finally {
        pendingIds.current.delete(citationId);
      }
    },
    [paperId, patchCitation],
  );

  // GSD-125: manual enrich trigger replaces the auto-on-view enrichment.
  // Disabled when every DOI-bearing ref is already enriched, or no ref has a
  // DOI (S2 cannot resolve without one).
  const canEnrich = useMemo(
    () => (rows ?? []).some(isUnenriched),
    [rows],
  );

  const handleEnrichClick = useCallback(async () => {
    if (manualEnrichPending) return;
    setManualEnrichPending(true);
    try {
      const res = await fetchOrThrowTrialExhausted(
        `/api/papers/${paperId}/citations/enrich`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!res.ok) {
        toast.error("Failed to enrich citations");
        return;
      }
      const next = await load();
      if (next && next.some(isUnenriched)) {
        clearPoll();
        pollAttempt.current = 0;
        setEnriching(true);
        scheduleNextPoll();
      }
    } catch (err) {
      if (err instanceof TrialExhaustedError) {
        surfaceTrialExhaustedToast();
        return;
      }
      // Match prior behaviour: any other thrown error was previously
      // uncaught (the original handler had no try/catch around the
      // fetch). Preserve that by re-throwing so an upstream boundary
      // can decide what to do.
      throw err;
    } finally {
      setManualEnrichPending(false);
    }
  }, [paperId, manualEnrichPending, load, scheduleNextPoll, clearPoll]);

  return (
    <section className="flex flex-col gap-3" data-testid="paper-citations-section">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Citations{rows ? ` · ${rows.length}` : ""}
        </p>
        <div className="flex items-center gap-2">
          {refreshing ? (
            <span className="text-[11px] text-muted-foreground">Extracting…</span>
          ) : enriching ? (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
              data-testid="citations-enriching"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Enriching
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="enrich-citations-button"
            disabled={!canEnrich || manualEnrichPending}
            onClick={handleEnrichClick}
            className="h-7 gap-1.5 text-[11px]"
          >
            {manualEnrichPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3 w-3" aria-hidden />
            )}
            Enrich citations
          </Button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">Couldn&rsquo;t load citations.</p>
      ) : rows === null ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No citations yet. Click &ldquo;Find citations&rdquo; to extract.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="paper-citations-list">
          {rows.map((c) => (
            <li key={c.id}>
              <CitationCard
                citation={c}
                variant="compact"
                matchedPaperId={c.matchedPaperId ?? null}
                citedInCount={c.citedInCount ?? 0}
                citingCount={c.citingCount ?? 0}
                folders={folders}
                onSaveToLibrary={(folderId) => handleSave(c.id, folderId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
