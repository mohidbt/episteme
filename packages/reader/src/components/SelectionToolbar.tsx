"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Yellow is reserved for the comment overlay color so highlights and
// comments stay visually distinct. Do not add "yellow" back here.
const COLORS = [
  { name: "green", class: "bg-green-300" },
  { name: "blue", class: "bg-blue-300" },
  { name: "pink", class: "bg-pink-300" },
  { name: "orange", class: "bg-orange-300" },
  { name: "purple", class: "bg-purple-300" },
] as const;

export type HighlightColor = (typeof COLORS)[number]["name"];

interface SelectionToolbarProps {
  rect: { top: number; left: number; width: number; height: number };
  onHighlight: (color: HighlightColor) => void;
  onDismiss: () => void;
  onComment?: (text: string) => void;
  onAskAi?: () => void;
  /**
   * Called when the user enters a long-lived sub-mode (e.g. typing a
   * comment) so the parent can snapshot the underlying selection and keep
   * this toolbar mounted even after the window selection clears.
   */
  onCommitStart?: () => void;
  /**
   * When set, the toolbar is operating on an existing highlight (click-to-edit
   * mode) and renders an Erase button that calls `onErase`. In this mode the
   * toolbar typically hides the Comment/Ask-AI actions since those flows
   * require a fresh text selection.
   */
  editingHighlightId?: number;
  onErase?: () => void;
}

export function SelectionToolbar({ rect, onHighlight, onDismiss, onComment, onAskAi, onCommitStart, editingHighlightId, onErase }: SelectionToolbarProps) {
  const [mode, setMode] = useState<"main" | "comment">("main");
  const [commentText, setCommentText] = useState("");

  const containerStyle: React.CSSProperties = {
    top: rect.top - 44,
    left: rect.left + rect.width / 2 - 80,
  };

  if (mode === "comment") {
    return (
      <div
        className="fixed z-50 flex flex-col gap-2 rounded-lg border bg-background p-2 shadow-lg w-64"
        style={containerStyle}
        // Stop pointer-down from bubbling out so clicking inside the popup
        // never triggers a window selectionchange that could clear the
        // active selection in the parent.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <textarea
          className="h-20 w-full rounded border p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          placeholder="Add a comment…"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setCommentText("");
              setMode("main");
              onDismiss();
            }
          }}
          autoFocus
        />
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCommentText("");
              setMode("main");
              onDismiss();
            }}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onComment?.(commentText);
              setCommentText("");
              setMode("main");
            }}
            className="text-xs"
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg"
      style={containerStyle}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {COLORS.map((c) => (
        <button
          type="button"
          key={c.name}
          className={`size-6 rounded-full ${c.class} border border-black/10 hover:ring-2 ring-offset-1`}
          onClick={() => onHighlight(c.name)}
          title={c.name}
          aria-label={`Highlight ${c.name}`}
        />
      ))}
      {onComment && !editingHighlightId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Snapshot the current selection in the parent BEFORE entering
            // comment mode — the upcoming focus shift will fire
            // `selectionchange` and null out the live selection state.
            onCommitStart?.();
            setMode("comment");
          }}
          className="ml-1 text-xs"
        >
          Comment
        </Button>
      )}
      {onAskAi && !editingHighlightId && (
        <Button variant="ghost" size="sm" onClick={onAskAi} className="text-xs">
          Ask AI
        </Button>
      )}
      {onErase && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onErase}
          aria-label="Erase highlight"
          title="Erase highlight"
          className="ml-1 text-xs text-destructive hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onDismiss} className="ml-1 text-xs">
        Cancel
      </Button>
    </div>
  );
}
