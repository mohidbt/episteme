"use client";

import { useCallback, useEffect, useState } from "react";

export interface AIHighlightRun {
  id: string;
  instruction: string;
  status: string;
  summary: string | null;
  createdAt: string;
  completedAt: string | null;
  highlightCount: number;
  hasStaleRects?: boolean;
}

interface Result {
  runs: AIHighlightRun[];
  loading: boolean;
  error: string | null;
  hiddenRunIds: Set<string>;
  toggleRun: (runId: string) => void;
  ensureVisible: (runId: string) => void;
  deleteRun: (runId: string, onChanged?: () => void) => Promise<void>;
  rebuildRun: (runId: string, onChanged?: () => void) => Promise<void>;
  rebuildingRunId: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetches AI auto-highlight runs for a document. Hidden-state is in memory only
 * (not persisted). Deletion calls the cascading route and refreshes overlays
 * via the `onChanged` callback.
 */
export function useAIHighlightRuns(documentId: number, refreshKey: number = 0): Result {
  const [runs, setRuns] = useState<AIHighlightRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenRunIds, setHiddenRunIds] = useState<Set<string>>(new Set());
  const [rebuildingRunId, setRebuildingRunId] = useState<string | null>(null);

  const fetchRuns = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/documents/${documentId}/auto-highlight/runs`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { runs: AIHighlightRun[] };
        setRuns(data.runs ?? []);
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Failed to load runs");
      } finally {
        setLoading(false);
      }
    },
    [documentId]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchRuns(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchRuns, refreshKey]);

  const toggleRun = useCallback((runId: string) => {
    setHiddenRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  // Remove runId from hidden set if present; no-op otherwise. Used when the
  // user clicks "Review highlights" to defensively un-hide the run's overlays.
  const ensureVisible = useCallback((runId: string) => {
    setHiddenRunIds((prev) => {
      if (!prev.has(runId)) return prev;
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
  }, []);

  const deleteRun = useCallback(
    async (runId: string, onChanged?: () => void) => {
      try {
        const res = await fetch(
          `/api/documents/${documentId}/auto-highlight/runs/${runId}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRuns((prev) => prev.filter((r) => r.id !== runId));
        setHiddenRunIds((prev) => {
          if (!prev.has(runId)) return prev;
          const next = new Set(prev);
          next.delete(runId);
          return next;
        });
        onChanged?.();
      } catch {
        setError("Failed to delete run");
      }
    },
    [documentId]
  );

  const rebuildRun = useCallback(
    async (runId: string, onChanged?: () => void) => {
      setRebuildingRunId(runId);
      try {
        const res = await fetch(
          `/api/documents/${documentId}/auto-highlight/runs/${runId}/rebuild`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchRuns();
        onChanged?.();
      } catch {
        setError("Failed to rebuild run");
      } finally {
        setRebuildingRunId(null);
      }
    },
    [documentId, fetchRuns]
  );

  const refetch = useCallback(() => fetchRuns(), [fetchRuns]);

  return {
    runs,
    loading,
    error,
    hiddenRunIds,
    toggleRun,
    ensureVisible,
    deleteRun,
    rebuildRun,
    rebuildingRunId,
    refetch,
  };
}
