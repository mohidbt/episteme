"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * GSD-74 round 4 (revised in GSD-125): shared enrichment polling for the
 * reader's citations sidebar.
 *
 * GSD-125 removed the auto-POST that fired when the sidebar opened — the
 * enrich path is now driven exclusively by the manual "Enrich citations"
 * button (mirroring PaperCitationsList on /p/[id]). This hook now owns the
 * polling loop only:
 *
 *   Polling. After a refresh (post-extract, post-manual-enrich) the
 *   citations snapshot still shows DOI-bearing refs with `enrichedAt == null`
 *   for ~10-90s while the server `after()` hook walks Semantic Scholar. We
 *   schedule a backoff poll until every DOI-bearing ref has `enrichedAt` set
 *   or we hit the ceiling.
 */

// Polling cadence: 8s wait, then 6s × 5, then 12s × 6 → ~90s ceiling. Same
// shape as apps/km/src/components/PaperCitationsList so both surfaces share a
// predictable user-visible enrichment latency.
export const CITATION_POLL_DELAYS_MS = [
  8000, 6000, 6000, 6000, 6000, 6000, 12000, 12000, 12000, 12000, 12000, 12000,
];

export interface EnrichableCitation {
  doi?: string | null;
  enrichedAt?: Date | string | null;
}

export function isUnenrichedDoiRef(row: EnrichableCitation): boolean {
  return row.enrichedAt == null && row.doi != null && row.doi.length > 0;
}

interface UseCitationEnrichmentArgs {
  paperId: string;
  citations: EnrichableCitation[];
  /** Refetch the citations list (typically bumps a refresh key). */
  onRefetch: () => void;
  /** Surface enrichment-in-flight state (drives the "Enriching…" banner). */
  onEnrichingChange?: (enriching: boolean) => void;
}

/**
 * Owns the backoff-polling loop. Gated on the same truth-source as the rest
 * of GSD-74: `enrichedAt == null && doi != null`. POST is no longer issued
 * here — see CitationsSidebar's manual "Enrich citations" button.
 */
export function useCitationEnrichment({
  paperId,
  citations,
  onRefetch,
  onEnrichingChange,
}: UseCitationEnrichmentArgs): void {
  // Keep latest callbacks in refs so polling effects don't restart on every
  // parent render.
  const onRefetchRef = useRef(onRefetch);
  const onEnrichingChangeRef = useRef(onEnrichingChange);
  useEffect(() => {
    onRefetchRef.current = onRefetch;
  });
  useEffect(() => {
    onEnrichingChangeRef.current = onEnrichingChange;
  });

  // Polling state.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptRef = useRef(0);
  const mountedRef = useRef(true);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current != null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const hasUnenriched = citations.some(isUnenrichedDoiRef);

  // Reset attempt counter on paper change.
  useEffect(() => {
    pollAttemptRef.current = 0;
  }, [paperId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, [clearPoll]);

  // Polling loop. Whenever the citations snapshot shows un-enriched DOI refs,
  // schedule the next refetch using the same backoff PaperCitationsList uses.
  useEffect(() => {
    clearPoll();
    if (!hasUnenriched) {
      onEnrichingChangeRef.current?.(false);
      pollAttemptRef.current = 0;
      return;
    }
    const attempt = pollAttemptRef.current;
    if (attempt >= CITATION_POLL_DELAYS_MS.length) {
      onEnrichingChangeRef.current?.(false);
      return;
    }
    onEnrichingChangeRef.current?.(true);
    const delay = CITATION_POLL_DELAYS_MS[attempt];
    pollAttemptRef.current = attempt + 1;
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      if (!mountedRef.current) return;
      onRefetchRef.current?.();
    }, delay);

    return () => clearPoll();
  }, [hasUnenriched, citations, clearPoll]);
}
