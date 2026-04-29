"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PapersetToolbar } from "./PapersetToolbar";
import { PapersetGrid } from "./PapersetGrid";
import { PapersetSelectionProvider } from "./lib/PapersetSelectionContext";
import { CellSelection } from "./lib/selection";
import {
  buildFilledKeys,
  cellKey,
  type CellGrounding,
  type ColumnSpec,
  type RowRef,
  type RunningCell,
} from "./lib/grid-helpers";
import { readSse } from "./lib/sse";

interface Props {
  id: string;
  initial: {
    columns: ColumnSpec[];
    rowRefs: RowRef[];
    cellGrounding: CellGrounding;
    runningCells: RunningCell[];
  };
  paperById: Record<
    string,
    { id: string; title: string | null; filename: string }
  >;
}

/**
 * Client wrapper that owns the paperset's interactive state and bridges it
 * between the toolbar (button) and the grid (cell rendering + clicks).
 *
 * State lives here so the toolbar can read `canRun` / `isRunning` and call
 * `runEnrichment` without going through a global event bus.
 */
export function PapersetView({ id, initial, paperById }: Props) {
  const router = useRouter();
  const [columns, setColumns] = useState<ColumnSpec[]>(initial.columns);
  const rowRefs = initial.rowRefs;

  const [cellValues, setCellValues] = useState<Map<string, string>>(new Map());
  const [runningKeys, setRunningKeys] = useState<Set<string>>(
    () => new Set(initial.runningCells.map((c) => cellKey(c.row, c.col))),
  );
  const [failedKeys, setFailedKeys] = useState<Map<string, string>>(new Map());
  const [, forceTick] = useState(0);
  const tick = useCallback(() => forceTick((n) => n + 1), []);

  const colNames = useMemo(() => columns.map((c) => c.name), [columns]);
  const filledKeys = useMemo(() => buildFilledKeys(cellValues), [cellValues]);

  const selectionRef = useRef<CellSelection>(
    new CellSelection({
      filledKeys,
      rowCount: rowRefs.length,
      cols: colNames,
    }),
  );

  useEffect(() => {
    selectionRef.current.setOpts({
      filledKeys,
      rowCount: rowRefs.length,
      cols: colNames,
    });
    tick();
  }, [filledKeys, rowRefs.length, colNames, tick]);

  const isRunning = runningKeys.size > 0;
  const canRun = !isRunning && !selectionRef.current.isEmpty();

  const markFailed = useCallback((keys: Set<string>, message: string) => {
    setRunningKeys(new Set());
    setFailedKeys((prev) => {
      const next = new Map(prev);
      for (const k of keys) next.set(k, message);
      return next;
    });
  }, []);

  const runEnrichment = useCallback(async () => {
    if (selectionRef.current.isEmpty() || isRunning) return;
    const cells = selectionRef.current.list().map((c) => ({
      row_idx: c.row,
      col_name: c.col,
    }));
    const newRunning = new Set(
      cells.map((c) => cellKey(c.row_idx, c.col_name)),
    );
    setRunningKeys(newRunning);
    setFailedKeys((prev) => {
      const next = new Map(prev);
      for (const k of newRunning) next.delete(k);
      return next;
    });

    let res: Response;
    try {
      res = await fetch(`/api/papersets/${id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells }),
      });
    } catch {
      markFailed(newRunning, "Network error");
      toast.error("Enrichment failed: network error");
      return;
    }
    if (!res.ok || !res.body) {
      markFailed(newRunning, `HTTP ${res.status}`);
      toast.error(`Enrichment failed: HTTP ${res.status}`);
      return;
    }
    try {
      for await (const ev of readSse(res.body)) {
        const data = safeJson(ev.data);
        if (ev.event === "cell_update" && data) {
          const k = cellKey(data.row as number, data.col as string);
          setCellValues((prev) => {
            const next = new Map(prev);
            next.set(k, String(data.value ?? ""));
            return next;
          });
          setRunningKeys((prev) => {
            if (!prev.has(k)) return prev;
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
        } else if (ev.event === "error" && data) {
          const message = String(data.message ?? "Enrichment failed");
          markFailed(newRunning, message);
          toast.error(message);
          return;
        }
      }
    } catch (err) {
      markFailed(newRunning, "Stream error");
      toast.error(
        `Enrichment stream error: ${(err as Error).message ?? "unknown"}`,
      );
      return;
    }
    setRunningKeys(new Set());
    router.refresh();
  }, [id, isRunning, markFailed, router]);

  // ⌘↵ keyboard handler (also guarded by canRun).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (selectionRef.current.isEmpty() || runningKeys.size > 0) return;
      e.preventDefault();
      void runEnrichment();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runEnrichment, runningKeys.size]);

  const ctxValue = useMemo(
    () => ({
      canRun,
      isRunning,
      runEnrichment: () => void runEnrichment(),
    }),
    [canRun, isRunning, runEnrichment],
  );

  return (
    <PapersetSelectionProvider value={ctxValue}>
      <PapersetToolbar id={id} />
      <PapersetGrid
        id={id}
        columns={columns}
        rowRefs={rowRefs}
        paperById={paperById}
        cellGrounding={initial.cellGrounding}
        cellValues={cellValues}
        runningKeys={runningKeys}
        failedKeys={failedKeys}
        selection={selectionRef.current}
        onSelectionChange={tick}
        onColumnsChange={setColumns}
        onCellValuesPurge={(predicate) =>
          setCellValues((prev) => {
            const next = new Map(prev);
            for (const k of [...next.keys()]) {
              if (predicate(k)) next.delete(k);
            }
            return next;
          })
        }
      />
    </PapersetSelectionProvider>
  );
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
