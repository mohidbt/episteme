"use client";

import { useState } from "react";
import { Plus, FilePlus2, Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AddColumnDialog } from "./AddColumnDialog";
import { usePapersetSelection } from "./lib/PapersetSelectionContext";

interface Props {
  id: string;
}

/**
 * Top action bar for the paperset viewer. Coordinates with the grid via
 * `PapersetSelectionContext` — the grid is the source of truth for both
 * the selection model and the running state.
 */
export function PapersetToolbar({ id }: Props) {
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
        <kbd className="ml-2 rounded border border-border/60 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          ⌘↵
        </kbd>
      </Button>

      <PaperPickerStubDialog
        open={paperPickerOpen}
        onOpenChange={setPaperPickerOpen}
      />
      <AddColumnDialog
        papersetId={id}
        open={addColumnOpen}
        onOpenChange={setAddColumnOpen}
      />
    </div>
  );
}

/**
 * Placeholder dialog. The real paper-picker ships in T11; this lets the
 * button live in the UI without faking data or wiring.
 */
function PaperPickerStubDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add papers</DialogTitle>
          <DialogDescription>
            The paper picker ships in the next task (T11). For now, papers can
            be added via API.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
