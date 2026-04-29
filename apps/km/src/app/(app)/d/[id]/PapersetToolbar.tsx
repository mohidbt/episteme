"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FilePlus2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaperPickerDialog } from "@/components/PaperPickerDialog";
import { AddColumnDialog } from "./AddColumnDialog";
import { usePapersetSelection } from "./lib/PapersetSelectionContext";
import type { ColumnSpec } from "./lib/grid-helpers";

interface Props {
  id: string;
  libraryId: number;
  existingPaperIds: string[];
  onColumnAdded: (column: ColumnSpec) => void;
}

/**
 * Top action bar for the paperset viewer. Coordinates with the grid via
 * `PapersetSelectionContext` — the grid is the source of truth for both
 * the selection model and the running state.
 */
export function PapersetToolbar({
  id,
  libraryId,
  existingPaperIds,
  onColumnAdded,
}: Props) {
  const router = useRouter();
  const [paperPickerOpen, setPaperPickerOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const { canRun, isRunning, runEnrichment } = usePapersetSelection();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-6 py-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPaperPickerOpen(true)}
      >
        <FilePlus2 className="size-4" aria-hidden /> Add papers
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAddColumnOpen(true)}
      >
        <Plus className="size-4" aria-hidden /> Add column
      </Button>
      <div className="flex-1" />
      <Button
        size="sm"
        onClick={runEnrichment}
        disabled={!canRun}
        data-testid="run-enrichment-btn"
      >
        {isRunning ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-4" aria-hidden />
        )}
        Run enrichment
        <span
          className="ml-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground"
          aria-label="Cmd+Enter"
        >
          <kbd className="inline-flex items-center justify-center rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono leading-none">
            ⌘
          </kbd>
          <span aria-hidden>+</span>
          <kbd className="inline-flex items-center justify-center rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono leading-none">
            ↵
          </kbd>
        </span>
      </Button>

      <PaperPickerDialog
        open={paperPickerOpen}
        onOpenChange={setPaperPickerOpen}
        libraryId={libraryId}
        excludeIds={existingPaperIds}
        onConfirm={async (paperIds) => {
          const res = await fetch(`/api/papersets/${id}/rows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paperIds }),
          });
          if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            toast.error(payload.error ?? "Failed to add papers");
            return;
          }
          setPaperPickerOpen(false);
          router.refresh();
        }}
      />
      <AddColumnDialog
        papersetId={id}
        open={addColumnOpen}
        onOpenChange={setAddColumnOpen}
        onColumnAdded={onColumnAdded}
      />
    </div>
  );
}
