"use client";

import { useCallback, useEffect, useState } from "react";
import { CitationCard, type CitationWithStatus } from "@episteme/reader";

interface PaperCitationsListProps {
  paperId: string;
}

interface CitationsResponse {
  citations: Array<CitationWithStatus & {
    matchedPaperId?: string | null;
    citedInCount?: number;
    citingCount?: number;
  }>;
}

export function citationsRefreshEvent(paperId: string): string {
  return `paper-citations-refresh:${paperId}`;
}

export function PaperCitationsList({ paperId }: PaperCitationsListProps) {
  const [rows, setRows] = useState<CitationsResponse["citations"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/papers/${paperId}/citations`, {
          credentials: "include",
          signal,
        });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as CitationsResponse;
        setError(null);
        setRows(data.citations ?? []);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      }
    },
    [paperId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    function onRefresh() {
      setRefreshing(true);
      load().finally(() => setRefreshing(false));
    }
    const evt = citationsRefreshEvent(paperId);
    window.addEventListener(evt, onRefresh);
    return () => window.removeEventListener(evt, onRefresh);
  }, [paperId, load]);

  return (
    <section className="flex flex-col gap-3" data-testid="paper-citations-section">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Citations{rows ? ` · ${rows.length}` : ""}
        </p>
        {refreshing && (
          <span className="text-[11px] text-muted-foreground">Extracting…</span>
        )}
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
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
