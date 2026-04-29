"use client";

import { createContext, useContext } from "react";

/**
 * Shared coordination state between PapersetToolbar and PapersetGrid.
 *
 * The Grid owns the canonical CellSelection model; the toolbar reads
 * `canRun` to enable/disable its "Run enrichment" button and calls
 * `runEnrichment` to trigger the same flow as ⌘↵.
 */
export interface PapersetSelectionContextValue {
  /** True iff there is at least one empty cell selected AND no run in progress. */
  canRun: boolean;
  /** True iff the SSE stream is open / a run is in progress. */
  isRunning: boolean;
  /** Trigger enrichment for the currently-selected cells. No-op when !canRun. */
  runEnrichment: () => void;
}

const Ctx = createContext<PapersetSelectionContextValue | null>(null);

export function PapersetSelectionProvider({
  value,
  children,
}: {
  value: PapersetSelectionContextValue;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePapersetSelection(): PapersetSelectionContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Toolbar may render before Grid in render order — provide safe fallback.
    return { canRun: false, isRunning: false, runEnrichment: () => {} };
  }
  return v;
}
