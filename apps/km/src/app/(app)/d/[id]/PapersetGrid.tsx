"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { CellSelection } from "./lib/selection";
import type {
  CellGrounding,
  ColumnSpec,
  RowRef,
} from "./lib/grid-helpers";
import { ColumnHeaderCell, RowView } from "./PapersetGridCells";

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

  function onCellMouseDown(e: React.MouseEvent, row: number, col: string) {
    if (e.button !== 0) return;
    if (e.shiftKey) selection.shiftClick({ row, col });
    else if (e.metaKey || e.ctrlKey) selection.cmdClick({ row, col });
    else selection.click({ row, col });
    onSelectionChange();
  }

  function onRowHeaderClick(row: number) {
    selection.clickRow(row);
    onSelectionChange();
  }

  function onColHeaderClick(col: string) {
    selection.clickCol(col);
    onSelectionChange();
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {failedKeys.size > 0 && (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/5 px-6 py-2 text-sm text-destructive"
        >
          {failedKeys.size === 1 ? "1 cell" : `${failedKeys.size} cells`}{" "}
          failed enrichment.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
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
                  onRemoveRow={() => removeRow(rowIdx)}
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
      </div>
    </div>
  );
}
