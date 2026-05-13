"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CellSelection } from "./lib/selection";
import type {
  CellGrounding,
  ColumnSpec,
  RowRef,
} from "./lib/grid-helpers";
import { ColumnHeaderCell, RowView } from "./PapersetGridCells";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface Props {
  id: string;
  columns: ColumnSpec[];
  rowRefs: RowRef[];
  paperById: Record<
    string,
    { id: string; title: string | null; filename: string }
  >;
  cellGrounding: CellGrounding;
  cellValues: Map<string, string>;
  runningKeys: Set<string>;
  failedKeys: Map<string, string>;
  selection: CellSelection;
  onSelectionChange: () => void;
  onColumnsChange: (next: (prev: ColumnSpec[]) => ColumnSpec[]) => void;
  onCellValuesPurge: (predicate: (key: string) => boolean) => void;
}

type DetailCell = {
  rowIdx: number;
  colName: string;
  value: string;
  paperTitle: string | null;
  pageAnchor: number | null;
  segmentAnchor: number | null;
};

/**
 * Presentational grid. All state lives in PapersetView; this component
 * renders headers, rows, cells, and dispatches click gestures back to the
 * shared CellSelection model. Mutating it directly is fine — the parent
 * forces a re-render via `onSelectionChange()`.
 */
export function PapersetGrid({
  id,
  columns,
  rowRefs,
  paperById,
  cellGrounding,
  cellValues,
  runningKeys,
  failedKeys,
  selection,
  onSelectionChange,
  onColumnsChange,
  onCellValuesPurge,
}: Props) {
  const router = useRouter();

  // #105: cell detail sheet state
  const [detailCell, setDetailCell] = useState<DetailCell | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dragStartRef = useRef<{ row: number; col: string } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [hoverTrail, setHoverTrail] = useState<string[]>([]);

  useEffect(() => {
    const stopDrag = () => {
      dragStartRef.current = null;
    };
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, []);

  function onCellMouseDown(e: React.MouseEvent, row: number, col: string) {
    if (e.button !== 0) return;
    dragStartRef.current = { row, col };
    if (e.shiftKey) selection.shiftClick({ row, col });
    else if (e.metaKey || e.ctrlKey) selection.cmdClick({ row, col });
    else selection.click({ row, col });
    onSelectionChange();
  }

  function onCellMouseEnter(row: number, col: string) {
    const key = `${row}:${col}`;
    setHoveredCell(key);
    setHoverTrail((prev) => [...prev.filter((k) => k !== key), key].slice(-8));

    const start = dragStartRef.current;
    if (!start) return;
    selection.click(start);
    selection.shiftClick({ row, col });
    onSelectionChange();
  }

  function clearCellHover() {
    setHoveredCell(null);
    setHoverTrail([]);
  }

  function onRowHeaderClick(row: number) {
    selection.clickRow(row);
    onSelectionChange();
  }

  function onColHeaderClick(col: string) {
    selection.clickCol(col);
    onSelectionChange();
  }

  // #105: clicking a filled cell opens the detail sheet
  function onCellClick(row: number, col: string) {
    const k = `${row}:${col}`;
    const value = cellValues.get(k);
    if (value === undefined) return; // empty cell — nothing to show
    const ground = cellGrounding[String(row)]?.[col];
    const firstBlockId = ground?.block_ids[0];
    const pageAnchor = firstBlockId
      ? extractPageFromBlockId(firstBlockId)
      : null;
    // #155: when only a segment/order index is available the value is too
    // confusing to surface (e.g. "#105" on a 15-page PDF). Show nothing —
    // re-enrichment regenerates page-anchored block IDs.
    const segmentAnchor = null;
    const paper = rowRefs[row]
      ? paperById[rowRefs[row].paper_id]
      : undefined;
    setDetailCell({
      rowIdx: row,
      colName: col,
      value,
      paperTitle: paper?.title ?? paper?.filename ?? null,
      pageAnchor,
      segmentAnchor,
    });
  }

  async function deleteColumn(name: string) {
    if (!confirm(`Delete column "${name}"? This removes all values in it.`))
      return;
    const res = await fetch(
      `/api/papersets/${id}/columns/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      toast.error("Failed to delete column");
      return;
    }
    onColumnsChange((cs) => cs.filter((c) => c.name !== name));
    onCellValuesPurge((k) => k.endsWith(`:${name}`));
    router.refresh();
  }

  async function editColumnDescription(col: ColumnSpec) {
    const description = prompt(
      `Description for "${col.name}"`,
      col.description,
    );
    if (description == null || description.trim() === col.description) return;
    const res = await fetch(
      `/api/papersets/${id}/columns/${encodeURIComponent(col.name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      },
    );
    if (!res.ok) {
      toast.error("Failed to update column");
      return;
    }
    onColumnsChange((cs) =>
      cs.map((c) =>
        c.name === col.name ? { ...c, description: description.trim() } : c,
      ),
    );
    router.refresh();
  }

  async function removeRow(rowIdx: number) {
    const res = await fetch(`/api/papersets/${id}/rows?index=${rowIdx}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to remove row");
      return;
    }
    router.refresh();
  }

  const selectionKind = selection.getKind();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [frameRect, setFrameRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root || selectionKind.kind === "none" || selectionKind.kind === "cells") {
      setFrameRect(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    if (selectionKind.kind === "row") {
      // #103a: exclude column-0 (title) from the selection frame — only
      // frame data cells (<td>), not the row header (<th>).
      const dataCells = root.querySelectorAll<HTMLElement>(
        `[data-testid^="cell-${selectionKind.row}-"]`,
      );
      if (dataCells.length === 0) {
        setFrameRect(null);
        return;
      }
      const firstRect = dataCells[0].getBoundingClientRect();
      const lastRect = dataCells[dataCells.length - 1].getBoundingClientRect();
      setFrameRect({
        top: firstRect.top - rootRect.top + root.scrollTop,
        left: firstRect.left - rootRect.left + root.scrollLeft,
        width: lastRect.right - firstRect.left,
        height: lastRect.bottom - firstRect.top,
      });
    } else {
      const cells = root.querySelectorAll<HTMLElement>(
        `[data-testid^="cell-"][data-col="${selectionKind.col}"]`,
      );
      const header = root.querySelector<HTMLElement>(
        `[data-testid="col-header-${selectionKind.col}"]`,
      );
      if (cells.length === 0 || !header) {
        setFrameRect(null);
        return;
      }
      const headerRect = header.getBoundingClientRect();
      const firstRect = cells[0].getBoundingClientRect();
      const lastRect = cells[cells.length - 1].getBoundingClientRect();
      setFrameRect({
        top: headerRect.bottom - rootRect.top + root.scrollTop,
        left: firstRect.left - rootRect.left + root.scrollLeft,
        width: firstRect.width,
        height: lastRect.bottom - firstRect.top,
      });
    }
  }, [
    selectionKind.kind,
    selectionKind.kind === "row" ? selectionKind.row : -1,
    selectionKind.kind === "col" ? selectionKind.col : "",
    columns.length,
    rowRefs.length,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      {failedKeys.size > 0 && (
        <div
          role="alert"
          className="mb-2 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-2 text-sm text-destructive"
        >
          {failedKeys.size === 1 ? "1 cell" : `${failedKeys.size} cells`}{" "}
          failed enrichment.
        </div>
      )}
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60"
        data-testid="paperset-grid-wrapper"
        onPointerLeave={clearCellHover}
      >
        <div
          ref={scrollRef}
          className="relative h-full w-full overflow-auto"
        >
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-sm"
          data-testid="paperset-grid"
        >
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="w-[280px] border-b border-r border-border/60 bg-muted/40 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Paper
              </th>
              {columns.map((col) => (
                <ColumnHeaderCell
                  key={col.name}
                  col={col}
                  onClickHeader={() => onColHeaderClick(col.name)}
                  onEdit={() => editColumnDescription(col)}
                  onDelete={() => deleteColumn(col.name)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rowRefs.map((ref, rowIdx) => {
              const paper = paperById[ref.paper_id] ?? {
                id: ref.paper_id,
                title: null,
                filename: "(missing paper)",
              };
              return (
                <RowView
                  key={`${ref.paper_id}-${rowIdx}`}
                  rowIdx={rowIdx}
                  paper={paper}
                  columns={columns}
                  cellGrounding={cellGrounding}
                  cellValues={cellValues}
                  runningKeys={runningKeys}
                  failedKeys={failedKeys}
                  selection={selection}
                  onRowHeaderClick={() => onRowHeaderClick(rowIdx)}
                  onCellMouseDown={onCellMouseDown}
                  onCellMouseEnter={onCellMouseEnter}
                  onCellMouseLeave={clearCellHover}
                  onCellClick={onCellClick}
                  onRemoveRow={() => removeRow(rowIdx)}
                  hoveredCell={hoveredCell}
                  hoverTrail={hoverTrail}
                />
              );
            })}
            {rowRefs.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-6 py-12 text-center text-sm text-muted-foreground"
                >
                  No papers in this paperset yet. Use{" "}
                  <span className="font-medium">Add papers</span> to get
                  started (T11).
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {frameRect &&
          (selectionKind.kind === "row" || selectionKind.kind === "col") && (
            <div
              data-testid="selection-frame"
              data-selection-kind={selectionKind.kind}
              aria-hidden
              className="pointer-events-none absolute rounded-md ring-2 ring-inset ring-primary/70"
              style={{
                top: frameRect.top,
                left: frameRect.left,
                width: frameRect.width,
                height: frameRect.height,
              }}
            />
          )}
        </div>
      </div>

      {/* #105: cell detail sheet */}
      <Sheet
        open={detailCell !== null}
        onOpenChange={(open) => {
          if (!open) setDetailCell(null);
        }}
      >
        <SheetContent
          data-testid="cell-detail-sheet"
          side="right"
        >
          <SheetHeader>
            <SheetTitle>
              {detailCell?.colName ?? "Cell detail"}
            </SheetTitle>
            {detailCell?.paperTitle && (
              <SheetDescription>{detailCell.paperTitle}</SheetDescription>
            )}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {detailCell?.value ?? ""}
            </p>
          </div>
          {detailCell?.pageAnchor != null && (
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              See more on Page {detailCell.pageAnchor}
            </div>
          )}
          {detailCell && (
            <div className="border-t px-4 py-3">
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                data-testid="cell-detail-delete"
                onClick={async () => {
                  if (!detailCell) return;
                  setDeleting(true);
                  try {
                    const res = await fetch(`/api/papersets/${id}/cells`, {
                      method: "DELETE",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        row: detailCell.rowIdx,
                        col: detailCell.colName,
                      }),
                    });
                    if (!res.ok) {
                      toast.error("Failed to delete cell");
                      return;
                    }
                    const key = `${detailCell.rowIdx}:${detailCell.colName}`;
                    onCellValuesPurge((k) => k === key);
                    setDetailCell(null);
                    router.refresh();
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Deleting…" : "Delete cell"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Extract page number from a block ID. Supports new format
 * `<paper_id>:p<page>:<order_index>` and legacy `block_<id>_p<page>_<idx>`.
 */
function extractPageFromBlockId(blockId: string): number | null {
  const newFmt = blockId.match(/:p(\d+):/);
  if (newFmt) {
    const n = Number.parseInt(newFmt[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m = blockId.match(/_p(\d+)_/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extract segment / order-index from a legacy `<paper_id>:<order_index>`
 * block ID when no page anchor is available. Returns null otherwise.
 */
function extractSegmentFromBlockId(blockId: string): number | null {
  if (/:p\d+:/.test(blockId) || /_p\d+_/.test(blockId)) return null;
  const i = blockId.lastIndexOf(":");
  if (i === -1 || i === blockId.length - 1) return null;
  const n = Number.parseInt(blockId.slice(i + 1), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
