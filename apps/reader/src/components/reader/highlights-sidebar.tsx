"use client";

import { useState, type ReactNode } from "react";
import { Trash2, Eye, EyeOff, ChevronDown, ChevronRight, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import type { AIHighlightRun } from "@/hooks/use-ai-highlight-runs";

interface Highlight {
  id: number;
  pageNumber: number;
  textContent: string;
  color: string;
  note: string | null;
  comment: string | null;
  createdAt: string;
}

const COLOR_MAP: Record<string, string> = {
  yellow: "border-l-yellow-400",
  green: "border-l-green-400",
  blue: "border-l-blue-400",
  pink: "border-l-pink-400",
  orange: "border-l-orange-400",
  amber: "border-l-amber-400",
};

interface HighlightsSidebarProps {
  open: boolean;
  highlights: Highlight[];
  loading: boolean;
  error: string | null;
  onAskAi?: (text: string, pageNumber: number) => void;
  onDelete?: (highlightId: number) => void;
  dockControl?: ReactNode;
  runs?: AIHighlightRun[];
  hiddenRunIds?: Set<string>;
  onToggleRun?: (runId: string) => void;
  onDeleteRun?: (runId: string) => void;
  onRebuildRun?: (runId: string) => void;
  rebuildingRunId?: string | null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function RunsSection({
  runs,
  hiddenRunIds,
  onToggleRun,
  onDeleteRun,
  onRebuildRun,
  rebuildingRunId,
}: {
  runs: AIHighlightRun[];
  hiddenRunIds: Set<string>;
  onToggleRun: (id: string) => void;
  onDeleteRun: (id: string) => void;
  onRebuildRun?: (id: string) => void;
  rebuildingRunId?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  if (runs.length === 0) return null;
  return (
    <div className="mb-4 border-b pb-3">
      <button
        type="button"
        className="mb-2 flex w-full items-center gap-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid="ai-runs-toggle"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span>AI Runs ({runs.length})</span>
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {runs.map((run) => {
            const hidden = hiddenRunIds.has(run.id);
            return (
              <div
                key={run.id}
                data-testid={`ai-run-${run.id}`}
                className="flex items-center gap-2 rounded border-l-2 border-l-blue-400/60 bg-muted/30 py-1 pl-2 pr-1 text-xs"
              >
                <Sparkles className="size-3 shrink-0 text-blue-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={run.instruction}>
                    {run.instruction}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {run.highlightCount} highlight{run.highlightCount === 1 ? "" : "s"}
                    {" · "}
                    {formatDate(run.createdAt)}
                  </p>
                </div>
                {run.hasStaleRects && onRebuildRun && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-label="Rebuild run"
                    title="Legacy positions — rebuild"
                    data-testid={`ai-run-rebuild-${run.id}`}
                    disabled={rebuildingRunId === run.id}
                    onClick={() => onRebuildRun(run.id)}
                  >
                    <RefreshCw
                      className={`size-3.5 ${rebuildingRunId === run.id ? "animate-spin" : ""}`}
                    />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  aria-label={hidden ? "Show run" : "Hide run"}
                  data-testid={`ai-run-toggle-${run.id}`}
                  onClick={() => onToggleRun(run.id)}
                >
                  {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  aria-label="Delete run"
                  data-testid={`ai-run-delete-${run.id}`}
                  onClick={() => {
                    if (!window.confirm("Delete this run and all its highlights?")) return;
                    onDeleteRun(run.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HighlightsSidebar({
  open,
  highlights,
  loading,
  error,
  onAskAi,
  onDelete,
  dockControl,
  runs,
  hiddenRunIds,
  onToggleRun,
  onDeleteRun,
  onRebuildRun,
  rebuildingRunId,
}: HighlightsSidebarProps) {
  if (!open) return null;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">Highlights</h2>
        {dockControl}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {runs && hiddenRunIds && onToggleRun && onDeleteRun && (
          <RunsSection
            runs={runs}
            hiddenRunIds={hiddenRunIds}
            onToggleRun={onToggleRun}
            onDeleteRun={onDeleteRun}
            onRebuildRun={onRebuildRun}
            rebuildingRunId={rebuildingRunId}
          />
        )}
        {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!loading && !error && highlights.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No highlights yet</EmptyTitle>
              <EmptyDescription>Select text to create one.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {!loading && !error && highlights.length > 0 && (
          <div className="space-y-3">
            {highlights.map((h) => (
              <div
                key={h.id}
                className={`border-l-4 ${COLOR_MAP[h.color] ?? "border-l-gray-300"} py-1 pl-3`}
              >
                <p className="line-clamp-3 text-xs leading-relaxed">{h.textContent}</p>
                {h.comment && (
                  <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs italic text-muted-foreground">
                    {h.comment}
                  </p>
                )}
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">Page {h.pageNumber}</p>
                  <div className="flex items-center gap-1">
                    {onAskAi && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-2 text-[10px]"
                        onClick={() => onAskAi(h.textContent, h.pageNumber)}
                      >
                        Ask AI
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-2 text-[10px] text-destructive hover:text-destructive"
                        aria-label="Delete"
                        onClick={() => {
                          if (!window.confirm("Delete this highlight?")) return;
                          onDelete(h.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
