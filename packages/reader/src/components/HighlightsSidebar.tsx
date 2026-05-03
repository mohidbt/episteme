"use client";

import { type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "./ui/empty";

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
}

export function HighlightsSidebar({
  open,
  highlights,
  loading,
  error,
  onAskAi,
  onDelete,
  dockControl,
}: HighlightsSidebarProps) {
  if (!open) return null;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">Highlights</h2>
        {dockControl}
      </div>
      <div className="flex-1 overflow-auto p-4">
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
