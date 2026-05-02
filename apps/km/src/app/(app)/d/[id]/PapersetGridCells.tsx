"use client";

import { Loader2, AlertCircle, MoreVertical } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CellGroundingChip } from "@/components/papersets/CellGroundingChip";
import type { CellSelection } from "./lib/selection";
import {
  deriveCellState,
  type CellGrounding,
  type ColumnSpec,
} from "./lib/grid-helpers";

export function RowView({
  rowIdx,
  paper,
  columns,
  cellGrounding,
  cellValues,
  runningKeys,
  failedKeys,
  selection,
  onRowHeaderClick,
  onCellMouseDown,
  onCellClick,
  onRemoveRow,
}: {
  rowIdx: number;
  paper: { id: string; title: string | null; filename: string };
  columns: ColumnSpec[];
  cellGrounding: CellGrounding;
  cellValues: Map<string, string>;
  runningKeys: Set<string>;
  failedKeys: Map<string, string>;
  selection: CellSelection;
  onRowHeaderClick: () => void;
  onCellMouseDown: (e: React.MouseEvent, row: number, col: string) => void;
  onCellClick: (row: number, col: string) => void;
  onRemoveRow: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<tr />}>
        <th
          scope="row"
          onClick={onRowHeaderClick}
          className="cursor-pointer truncate border-b border-r border-border/60 bg-muted/20 px-3 py-2 text-left font-normal text-foreground hover:bg-muted/40"
          title={paper.title ?? paper.filename}
          data-testid={`row-header-${rowIdx}`}
        >
          <span className="block truncate">
            {paper.title?.trim() || paper.filename}
          </span>
        </th>
        {columns.map((col) => {
          const state = deriveCellState(rowIdx, col.name, {
            runningKeys,
            failedKeys,
            cellValues,
            grounding: cellGrounding,
          });
          const selected = selection.has({ row: rowIdx, col: col.name });
          const ground = cellGrounding[String(rowIdx)]?.[col.name];
          return (
            <CellView
              key={col.name}
              state={state}
              selected={selected}
              showRing={selection.getKind().kind === "cells"}
              colName={col.name}
              groundingPaperId={ground?.paper_id ?? paper.id}
              groundingBlockIds={ground?.block_ids ?? []}
              onMouseDown={(e) => onCellMouseDown(e, rowIdx, col.name)}
              onClick={() => onCellClick(rowIdx, col.name)}
              testId={`cell-${rowIdx}-${col.name}`}
            />
          );
        })}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            if (confirm("Remove this row from the paperset?")) onRemoveRow();
          }}
          className="text-destructive"
          data-testid={`remove-row-${rowIdx}`}
        >
          Remove row
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ColumnHeaderCell({
  col,
  onClickHeader,
  onEdit,
  onDelete,
}: {
  col: ColumnSpec;
  onClickHeader: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <th
            onClick={onClickHeader}
            className="group cursor-pointer border-b border-r border-border/60 bg-muted/40 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/60"
            data-testid={`col-header-${col.name}`}
          />
        }
      >
        <div className="flex items-center justify-between gap-2">
          <Tooltip>
            <TooltipTrigger render={<span className="truncate" />}>
              {col.name}
            </TooltipTrigger>
            <TooltipContent>{col.description}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"
                  aria-label={`Actions for column ${col.name}`}
                  data-testid={`col-menu-${col.name}`}
                >
                  <MoreVertical className="size-3.5" aria-hidden />
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                Edit description
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive"
              >
                Delete column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onEdit}>Edit description</ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-destructive">
          Delete column
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CellView({
  state,
  selected,
  showRing,
  colName,
  groundingPaperId,
  groundingBlockIds,
  onMouseDown,
  onClick,
  testId,
}: {
  state: ReturnType<typeof deriveCellState>;
  selected: boolean;
  showRing: boolean;
  colName: string;
  groundingPaperId: string;
  groundingBlockIds: string[];
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: () => void;
  testId: string;
}) {
  return (
    <td
      onMouseDown={onMouseDown}
      onClick={state.kind === "filled" ? onClick : undefined}
      className={cn(
        "relative h-9 cursor-cell border-b border-r border-border/60 px-3 py-1.5 align-middle",
        selected && "bg-primary/10",
        selected && showRing && "ring-2 ring-inset ring-primary/70",
      )}
      data-cell-state={state.kind}
      data-selected={selected ? "true" : "false"}
      data-col={colName}
      data-testid={testId}
    >
      {state.kind === "empty" && (
        <span className="text-muted-foreground/40">—</span>
      )}
      {state.kind === "running" && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          <span className="text-xs">running…</span>
        </span>
      )}
      {state.kind === "failed" && (
        <span
          className="flex items-center gap-1 text-destructive"
          title={state.message}
        >
          <AlertCircle className="size-3" aria-hidden />
          <span className="text-xs">failed</span>
        </span>
      )}
      {state.kind === "filled" && (
        <span className="flex items-center gap-1.5">
          <span className="truncate">{state.value}</span>
          {/* #155: chip renders `p.<n>` when a page anchor is parseable;
              hides for legacy/segment-only block IDs. */}
          {groundingBlockIds.length > 0 && (
            <CellGroundingChip
              paperId={groundingPaperId}
              blockIds={groundingBlockIds}
              className="shrink-0"
            />
          )}
        </span>
      )}
    </td>
  );
}