"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * GSD-74 round 4: shared enrichment orchestration for the reader's citations
 * sidebar (and any other surface that lists per-paper citations).
 *
 * Two responsibilities the per-component effects kept getting wrong:
 *
 * 1. Polling. The GET /citations route's `after()` hook persists enrichment
 *    per-ref over ~10-90s. The reader's sidebar previously only refetched
 *    once via `onExtracted`, so chips stayed "enriching…" forever even after
 *    DB rows had been stamped. We schedule a backoff poll until every
 *    DOI-bearing ref has `enrichedAt` set or we hit the ceiling.
 *
 * 2. Re-POST gate across remount. The sidebar can be closed and reopened
 *    while polling is still in flight; without a parent-level gate, every
 *    reopen re-POSTs `/enrich`. We key the gate by paperId so navigating
 *    documents resets correctly.
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
  /** Sidebar visible — gates the initial POST. Polling continues regardless. */
  open: boolean;
  citations: EnrichableCitation[];
  /** Refetch the citations list (typically bumps a refresh key). */
  onRefetch: () => void;
  /** Surface enrichment-in-flight state (drives the "Enriching…" banner). */
  onEnrichingChange?: (enriching: boolean) => void;
}

/**
 * Owns the enrich POST + the backoff-polling loop. Both gated on the same
 * truth-source as the rest of GSD-74: `enrichedAt == null && doi != null`.
 */
export function useCitationEnrichment({
  paperId,
  open,
  citations,
  onRefetch,
  onEnrichingChange,
}: UseCitationEnrichmentArgs): void {
  // Keep latest callbacks in refs so polling/POST effects don't restart on
  // every parent render.
  const onRefetchRef = useRef(onRefetch);
  const onEnrichingChangeRef = useRef(onEnrichingChange);
  useEffect(() => {
    onRefetchRef.current = onRefetch;
  });
  useEffect(() => {
    onEnrichingChangeRef.current = onEnrichingChange;
  });

  // Per-paperId POST gate. Survives sidebar close+reopen for the same paper.
  const enrichPostedForPaperRef = useRef<string | null>(null);

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

  // Snapshot whether there is any unenriched DOI ref. Effects below read this
  // via the citations array directly; this hoist keeps the dep narrow.
  const hasUnenriched = citations.some(isUnenrichedDoiRef);

  // Reset POST gate when paper changes.
  useEffect(() => {
    enrichPostedForPaperRef.current = null;
  }, [paperId]);

  // POST /enrich once per paper, gated on sidebar being open + un-enriched
  // DOI refs present. Subsequent opens (same paper) skip because the gate is
  // parent-owned, not per-component.
  useEffect(() => {
    if (!open) return;
    if (!hasUnenriched) return;
    if (enrichPostedForPaperRef.current === paperId) return;

    enrichPostedForPaperRef.current = paperId;
    const controller = new AbortController();
    onEnrichingChangeRef.current?.(true);

    fetch(`/api/papers/${paperId}/citations/enrich`, {
      method: "POST",
      signal: controller.signal,
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`enrich failed: ${res.status}`);
        return res.json();
      })
      .then(() => {
        if (!mountedRef.current) return;
        onRefetchRef.current?.();
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        // Allow retry on next open/paper-change by clearing the gate.
        enrichPostedForPaperRef.current = null;
        // eslint-disable-next-line no-console
        console.error("[citation-enrichment] enrich error", err);
      });

    return () => controller.abort();
  }, [paperId, open, hasUnenriched]);

  // Polling loop. Whenever the citations snapshot shows un-enriched DOI refs,
  // schedule the next refetch using the same backoff PaperCitationsList uses.
  // Resets attempt counter on paper change.
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
