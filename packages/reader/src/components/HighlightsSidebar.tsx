"use client";

import { type ReactNode, useState, useCallback, useEffect, useRef } from "react";
import { Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";

export interface AiHighlight {
  id: number | string;
  pageNumber: number;
  textContent: string;
  color: string;
  note: string | null;
  comment: string | null;
  createdAt: string;
  runId?: string | null;
  toolCallId?: string | null;
}

export interface UserHighlightItem {
  id: number | string;
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

type Segment = "ai" | "user";

interface HighlightsSidebarProps {
  open: boolean;
  /** AI-sourced highlights (source === "ai-auto") */
  aiHighlights: AiHighlight[];
  /** User-created highlights */
  userHighlights: UserHighlightItem[];
  runs?: { id: string; instruction: string; summary: string | null; highlightCount: number }[];
  loading: boolean;
  error: string | null;
  paperId: string;
  onAskAi?: (text: string, pageNumber: number) => void;
  onDelete?: (highlightId: number | string) => void;
  onNavigateHighlight?: (highlightId: number | string) => void;
  dockControl?: ReactNode;
}

function storageKey(paperId: string) {
  return `reader-highlights-segment:${paperId}`;
}

function readPersistedSegment(paperId: string, hasAiRuns: boolean): Segment {
  try {
    const stored = localStorage.getItem(storageKey(paperId));
    if (stored === "ai" || stored === "user") return stored;
  } catch {
    // localStorage unavailable
  }
  return hasAiRuns ? "ai" : "user";
}

export function HighlightsSidebar({
  open,
  aiHighlights,
  userHighlights,
  runs = [],
  loading,
  error,
  paperId,
  onAskAi,
  onDelete,
  onNavigateHighlight,
  dockControl,
}: HighlightsSidebarProps) {
  // Group AI highlights by runId only. Highlights without runId all collapse
  // into a single "manual" pseudo-run keyed by "".
  const grouped = aiHighlights.reduce<Record<string, AiHighlight[]>>((acc, h) => {
    const key = h.runId ?? "";
    acc[key] = acc[key] ?? [];
    acc[key].push(h);
    return acc;
  }, {});

  const hasAiRuns = runs.length > 0 || Object.values(grouped).some((g) => g.length > 0);

  const [segment, setSegment] = useState<Segment>(() =>
    readPersistedSegment(paperId, hasAiRuns),
  );
  // Per-run cursor for prev/next navigation — persisted only in component state.
  const [runCursors, setRunCursors] = useState<Record<string, number>>({});

  // Reset cursors when the paper changes so stale positions don't bleed across.
  useEffect(() => {
    setRunCursors({});
  }, [paperId]);

  const switchSegment = useCallback(
    (next: Segment) => {
      setSegment(next);
      try {
        localStorage.setItem(storageKey(paperId), next);
      } catch {
        // ignore
      }
    },
    [paperId],
  );

  // Keep grouped in a ref so functional setState below can read the latest
  // groups without forcing `navigate` to be recreated on every render (which
  // would defeat the stable-callback contract callers rely on).
  const groupedRef = useRef(grouped);
  useEffect(() => {
    groupedRef.current = grouped;
  });

  const navigate = useCallback(
    (runId: string, delta: number) => {
      const group = groupedRef.current[runId] ?? [];
      if (group.length === 0) return;
      setRunCursors((prev) => {
        const current = prev[runId] ?? 0;
        const next = (current + delta + group.length) % group.length;
        onNavigateHighlight?.(group[next].id);
        return { ...prev, [runId]: next };
      });
    },
    [onNavigateHighlight],
  );

  if (!open) return null;

  // Build the list of run entries to display in the AI segment.
  // Named runs first, then the "manual" bucket (runId === "").
  const namedRunEntries = runs.map((r) => ({
    id: r.id,
    label: r.summary ?? r.instruction,
    group: grouped[r.id] ?? [],
  }));
  const manualGroup = grouped[""] ?? [];

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">Highlights</h2>
        {dockControl}
      </div>

      {/* Segmented control */}
      <div role="tablist" className="flex border-b px-4 pt-2">
        <button
          type="button"
          role="tab"
          aria-pressed={segment === "user"}
          onClick={() => switchSegment("user")}
          className={[
            "mr-4 pb-2 text-xs font-medium transition-colors",
            segment === "user"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          User
        </button>
        <button
          type="button"
          role="tab"
          aria-pressed={segment === "ai"}
          onClick={() => switchSegment("ai")}
          className={[
            "pb-2 text-xs font-medium transition-colors",
            segment === "ai"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          AI
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {!loading && !error && segment === "user" && (
          <>
            {userHighlights.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No highlights yet</EmptyTitle>
                  <EmptyDescription className="text-xs text-muted-foreground/70">
                    Select text to highlight.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="space-y-3">
                {userHighlights.map((h) => (
                  <UserHighlightRow
                    key={h.id}
                    highlight={h}
                    onAskAi={onAskAi}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!loading && !error && segment === "ai" && (
          <>
            {namedRunEntries.length === 0 && manualGroup.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No AI highlights yet</EmptyTitle>
                  <EmptyDescription className="text-xs text-muted-foreground/70">
                    Ask the agent to highlight something.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="space-y-3">
                {namedRunEntries.map(({ id, label, group }) => {
                  if (group.length === 0) return null;
                  const cursor = runCursors[id] ?? 0;
                  return (
                    <RunRow
                      key={id}
                      label={label}
                      group={group}
                      cursor={cursor}
                      onNavigateFirst={() => onNavigateHighlight?.(group[0].id)}
                      onPrev={() => navigate(id, -1)}
                      onNext={() => navigate(id, 1)}
                    />
                  );
                })}

                {/* Manual / no-runId bucket — single collapsed row */}
                {manualGroup.length > 0 && (
                  <RunRow
                    label="Manual AI highlights"
                    group={manualGroup}
                    cursor={runCursors[""] ?? 0}
                    onNavigateFirst={() => onNavigateHighlight?.(manualGroup[0].id)}
                    onPrev={() => navigate("", -1)}
                    onNext={() => navigate("", 1)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function RunRow({
  label,
  group,
  cursor,
  onNavigateFirst,
  onPrev,
  onNext,
}: {
  label: string;
  group: AiHighlight[];
  cursor: number;
  onNavigateFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const truncated = label.length > 60 ? `${label.slice(0, 60)}…` : label;
  return (
    <div className="rounded border p-2">
      <button
        type="button"
        className="w-full text-left"
        aria-label={label}
        onClick={onNavigateFirst}
      >
        <p className="text-xs font-medium">
          {truncated} ({group.length})
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {cursor + 1} / {group.length}
        </p>
      </button>
      <div className="mt-1 flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1"
          onClick={onPrev}
          aria-label="Previous highlight"
        >
          <ChevronLeft className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1"
          onClick={onNext}
          aria-label="Next highlight"
        >
          <ChevronRight className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function UserHighlightRow({
  highlight: h,
  onAskAi,
  onDelete,
}: {
  highlight: UserHighlightItem;
  onAskAi?: (text: string, pageNumber: number) => void;
  onDelete?: (id: number | string) => void;
}) {
  return (
    <div
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
  );
}
